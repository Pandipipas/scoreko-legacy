<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useQuasar } from 'quasar';
import { useBracketStore } from '../stores/bracket';
import { usePlayersStore } from '../stores/players';
import { t } from '../i18n';
import type { BulkParticipantInput, ImportedPlayer, TournamentStateAction } from '../../../types';

defineOptions({ name: 'TournamentManageDialog' });

const props = defineProps<{
  modelValue: boolean;
  slug: string;
  name?: string;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', val: boolean): void;
}>();

const $q = useQuasar();
const bracketStore = useBracketStore();
const playersStore = usePlayersStore();

const activeTab = ref<'status' | 'participants' | 'bulkAdd'>('status');

const isDialogOpen = computed({
  get: () => props.modelValue,
  set: (val: boolean) => emit('update:modelValue', val),
});

const effectiveSlug = computed(() => {
  return props.slug || bracketStore.challongeTournamentSlug || bracketStore.attached.tournamentSlug || '';
});

const effectiveName = computed(() => {
  return props.name || effectiveSlug.value;
});

const participants = ref<ImportedPlayer[]>([]);
const loadingParticipants = ref(false);

const loadParticipants = async () => {
  const slug = effectiveSlug.value;
  if (!slug) return;
  loadingParticipants.value = true;
  try {
    const list = await bracketStore.fetchChallongeParticipants(slug);
    participants.value = list;
    
    // Auto-sync into playersStore
    for (const p of list) {
      const existingId = playersStore.findExistingPlayer(p);
      if (existingId) {
        playersStore.mergeIncomingPlayer(existingId, p);
      } else {
        playersStore.upsertPlayer(p.id, {
          gamertag: p.gamertag,
          name: p.name || p.gamertag,
          team: p.team || '',
          country: p.country || '',
          twitter: p.twitter || '',
          avatarUrl: p.avatarUrl || '',
          challongeId: p.challongeId || p.id,
        });
      }
    }
  } catch {
    // Handled in store
  } finally {
    loadingParticipants.value = false;
  }
};

watch(() => props.modelValue, (isOpen) => {
  if (isOpen) {
    activeTab.value = 'status';
    loadParticipants();
  }
});

// Single Participant Form
const newPlayerName = ref('');
const newPlayerSeed = ref<number | null>(null);
const isAddingSingle = ref(false);

const handleAddParticipant = async () => {
  const slug = effectiveSlug.value;
  const name = newPlayerName.value.trim();
  if (!slug || !name) return;

  isAddingSingle.value = true;
  try {
    const updated = await bracketStore.createChallongeParticipant(slug, {
      name,
      seed: newPlayerSeed.value !== null && Number.isFinite(newPlayerSeed.value) ? newPlayerSeed.value : undefined,
    });
    participants.value = updated;
    newPlayerName.value = '';
    newPlayerSeed.value = null;
    loadParticipants();
  } catch {
    // Handled in store
  } finally {
    isAddingSingle.value = false;
  }
};

// Bulk Participant Form
const bulkInputText = ref('');
const isBulkAdding = ref(false);

const handleBulkAdd = async () => {
  const slug = effectiveSlug.value;
  if (!slug || !bulkInputText.value.trim()) return;

  const lines = bulkInputText.value.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return;

  const parsedParticipants: BulkParticipantInput[] = [];

  for (const line of lines) {
    const pipeIndex = line.indexOf('|');
    if (pipeIndex !== -1) {
      const leftPart = line.substring(0, pipeIndex).trim();
      const rightPart = line.substring(pipeIndex + 1).trim();
      const parsedSeed = Number(leftPart);

      if (Number.isFinite(parsedSeed) && rightPart) {
        parsedParticipants.push({ name: rightPart, seed: parsedSeed });
      } else if (leftPart && rightPart) {
        parsedParticipants.push({ name: `${leftPart} | ${rightPart}` });
      } else if (rightPart) {
        parsedParticipants.push({ name: rightPart });
      } else if (leftPart) {
        parsedParticipants.push({ name: leftPart });
      }
    } else {
      parsedParticipants.push({ name: line });
    }
  }

  if (!parsedParticipants.length) return;

  isBulkAdding.value = true;
  try {
    const updated = await bracketStore.bulkCreateChallongeParticipants(slug, parsedParticipants);
    participants.value = updated;
    bulkInputText.value = '';
    activeTab.value = 'participants';
    loadParticipants();
  } catch {
    // Handled in store
  } finally {
    isBulkAdding.value = false;
  }
};

// Randomize Seeds
const isRandomizing = ref(false);

const confirmRandomizeSeeds = () => {
  const slug = effectiveSlug.value;
  if (!slug) return;

  $q.dialog({
    title: t('challongeRandomizeTitle'),
    message: t('challongeRandomizeMsg'),
    dark: true,
    cancel: {
      flat: true,
      label: t('cancel'),
      color: 'secondary',
    },
    ok: {
      unelevated: true,
      label: t('dialogConfirm'),
      color: 'primary',
    },
  }).onOk(async () => {
    isRandomizing.value = true;
    try {
      const updated = await bracketStore.randomizeChallongeSeeds(slug);
      participants.value = updated;
      loadParticipants();
    } catch {
      // Handled in store
    } finally {
      isRandomizing.value = false;
    }
  });
};

// Delete Participant
const isDeletingId = ref<string | null>(null);

const confirmDeleteParticipant = (player: ImportedPlayer) => {
  const slug = effectiveSlug.value;
  if (!slug) return;

  $q.dialog({
    title: t('challongeDeleteParticipantTitle'),
    message: t('challongeDeleteParticipantMsg', { name: player.gamertag }),
    dark: true,
    cancel: {
      flat: true,
      label: t('cancel'),
      color: 'secondary',
    },
    ok: {
      unelevated: true,
      label: t('dialogConfirm'),
      color: 'negative',
    },
  }).onOk(async () => {
    isDeletingId.value = player.id;
    try {
      const updated = await bracketStore.deleteChallongeParticipant(slug, player.id);
      participants.value = updated;
      loadParticipants();
    } catch {
      // Handled in store
    } finally {
      isDeletingId.value = null;
    }
  });
};

// Lifecycle State Changes
const isChangingState = ref(false);

const confirmChangeState = (action: TournamentStateAction) => {
  const slug = effectiveSlug.value;
  if (!slug) return;

  const actionName = action === 'start'
    ? t('challongeActionStart')
    : action === 'finalize'
      ? t('challongeActionFinalize')
      : t('challongeActionReset');

  $q.dialog({
    title: t('challongeConfirmStateTitle'),
    message: t('challongeConfirmStateMsg', { action: actionName }),
    dark: true,
    cancel: {
      flat: true,
      label: t('cancel'),
      color: 'secondary',
    },
    ok: {
      unelevated: true,
      label: t('dialogConfirm'),
      color: action === 'reset' ? 'negative' : 'primary',
    },
  }).onOk(async () => {
    isChangingState.value = true;
    try {
      await bracketStore.changeChallongeTournamentState(slug, action);
      loadParticipants();
    } catch {
      // Handled in store
    } finally {
      isChangingState.value = false;
    }
  });
};

const sortedParticipants = computed(() => {
  return [...participants.value].sort((a, b) => {
    if (a.seed !== undefined && b.seed !== undefined) return a.seed - b.seed;
    if (a.seed !== undefined) return -1;
    if (b.seed !== undefined) return 1;
    return a.gamertag.localeCompare(b.gamertag);
  });
});
</script>

<template>
  <QDialog
    v-model="isDialogOpen"
    backdrop-filter="blur(4px) brightness(60%)"
  >
    <QCard
      flat
      bordered
      class="glass-panel manage-dialog"
    >
      <!-- HEADER -->
      <div class="q-pa-md q-pb-none row justify-between items-start border-bottom-subtle">
        <div class="row items-center q-gutter-x-sm">
          <QIcon
            name="tune"
            color="primary"
            size="md"
          />
          <div>
            <div class="text-h6 text-weight-bold text-base leading-tight">
              {{ effectiveName }}
            </div>
            <div class="text-caption text-muted">
              {{ effectiveSlug }}
            </div>
          </div>
        </div>

        <QBtn
          v-close-popup
          flat
          round
          dense
          icon="close"
          class="subtle-action-btn text-muted"
        />
      </div>

      <!-- TABS -->
      <QTabs
        v-model="activeTab"
        align="left"
        class="text-grey-5 border-bottom-subtle"
        active-color="primary"
        indicator-color="primary"
        narrow-indicator
        dense
      >
        <QTab
          name="status"
          :label="t('challongeTabStatus')"
          icon="tune"
          no-caps
        />
        <QTab
          name="participants"
          icon="groups"
          no-caps
        >
          <div class="row items-center q-gutter-x-xs">
            <span>{{ t('challongeTabParticipants') }}</span>
            <QBadge
              v-if="participants.length > 0"
              color="primary"
              rounded
              class="q-ml-xs"
            >
              {{ participants.length }}
            </QBadge>
          </div>
        </QTab>
        <QTab
          name="bulkAdd"
          :label="t('challongeTabBulkAdd')"
          icon="playlist_add"
          no-caps
        />
      </QTabs>

      <!-- TAB PANELS -->
      <QTabPanels
        v-model="activeTab"
        animated
        class="bg-transparent tab-panels-fixed"
      >
        <!-- TAB 1: STATUS -->
        <QTabPanel
          name="status"
          class="q-pa-md"
        >
          <div class="column q-gutter-y-md manage-tab-content">
            <div class="text-caption text-muted">
              {{ t('challongeStatusSubtitle') }}
            </div>

            <div class="column q-gutter-y-sm">
              <!-- START TOURNAMENT CARD -->
              <div
                class="status-action-card row items-center no-wrap justify-between q-pa-md cursor-pointer"
                :class="{ 'card-disabled': isChangingState }"
                @click="confirmChangeState('start')"
              >
                <div class="row items-center no-wrap q-gutter-x-md col">
                  <div class="icon-avatar primary-avatar row items-center justify-center">
                    <QIcon
                      name="play_arrow"
                      size="24px"
                    />
                  </div>
                  <div class="column col">
                    <div class="text-subtitle2 text-weight-bold text-base">
                      {{ t('challongeBtnStartTournament') }}
                    </div>
                    <div class="text-caption text-muted action-desc">
                      {{ t('challongeDescStartTournament') }}
                    </div>
                  </div>
                </div>
                <div class="col-auto q-ml-md">
                  <QBtn
                    unelevated
                    dense
                    no-caps
                    color="primary"
                    icon="play_arrow"
                    :label="t('challongeBtnStartTournament')"
                    :loading="isChangingState"
                    class="primary-action-btn card-action-btn"
                    @click.stop="confirmChangeState('start')"
                  />
                </div>
              </div>

              <!-- FINALIZE TOURNAMENT CARD -->
              <div
                class="status-action-card row items-center no-wrap justify-between q-pa-md cursor-pointer"
                :class="{ 'card-disabled': isChangingState }"
                @click="confirmChangeState('finalize')"
              >
                <div class="row items-center no-wrap q-gutter-x-md col">
                  <div class="icon-avatar secondary-avatar row items-center justify-center">
                    <QIcon
                      name="emoji_events"
                      size="24px"
                    />
                  </div>
                  <div class="column col">
                    <div class="text-subtitle2 text-weight-bold text-base">
                      {{ t('challongeBtnFinalizeTournament') }}
                    </div>
                    <div class="text-caption text-muted action-desc">
                      {{ t('challongeDescFinalizeTournament') }}
                    </div>
                  </div>
                </div>
                <div class="col-auto q-ml-md">
                  <QBtn
                    outline
                    dense
                    no-caps
                    color="secondary"
                    icon="emoji_events"
                    :label="t('challongeBtnFinalizeTournament')"
                    :loading="isChangingState"
                    class="card-action-btn"
                    @click.stop="confirmChangeState('finalize')"
                  />
                </div>
              </div>

              <!-- RESET TOURNAMENT CARD -->
              <div
                class="status-action-card row items-center no-wrap justify-between q-pa-md cursor-pointer"
                :class="{ 'card-disabled': isChangingState }"
                @click="confirmChangeState('reset')"
              >
                <div class="row items-center no-wrap q-gutter-x-md col">
                  <div class="icon-avatar danger-avatar row items-center justify-center">
                    <QIcon
                      name="replay"
                      size="24px"
                    />
                  </div>
                  <div class="column col">
                    <div class="text-subtitle2 text-weight-bold text-base">
                      {{ t('challongeBtnResetTournament') }}
                    </div>
                    <div class="text-caption text-muted action-desc">
                      {{ t('challongeDescResetTournament') }}
                    </div>
                  </div>
                </div>
                <div class="col-auto q-ml-md">
                  <QBtn
                    outline
                    dense
                    no-caps
                    color="negative"
                    icon="replay"
                    :label="t('challongeBtnResetTournament')"
                    :loading="isChangingState"
                    class="card-action-btn"
                    @click.stop="confirmChangeState('reset')"
                  />
                </div>
              </div>
            </div>
          </div>
        </QTabPanel>

        <!-- TAB 2: PARTICIPANTS -->
        <QTabPanel
          name="participants"
          class="q-pa-md"
        >
          <div class="column q-gutter-y-sm manage-tab-content">
            <!-- QUICK ADD BAR -->
            <div class="row q-col-gutter-sm items-center no-wrap">
              <div class="col">
                <QInput
                  v-model="newPlayerName"
                  dense
                  :placeholder="t('challongeAddPlayerPlaceholder')"
                  class="underlined-field"
                  @keydown.enter="handleAddParticipant"
                />
              </div>
              <div
                class="col-auto"
                style="width: 90px;"
              >
                <QInput
                  v-model.number="newPlayerSeed"
                  type="number"
                  dense
                  :placeholder="t('challongeSeedPlaceholder')"
                  class="underlined-field"
                  @keydown.enter="handleAddParticipant"
                />
              </div>
              <div class="col-auto">
                <QBtn
                  unelevated
                  dense
                  no-caps
                  color="primary"
                  icon="add"
                  :label="t('challongeAddSingleBtn')"
                  class="primary-action-btn no-wrap"
                  :loading="isAddingSingle"
                  :disable="!newPlayerName.trim()"
                  @click="handleAddParticipant"
                />
              </div>
            </div>

            <!-- CONTROLS ROW -->
            <div class="row items-center justify-between no-wrap q-py-xs border-bottom-subtle">
              <div class="text-caption text-muted text-weight-medium font-mono">
                {{ t('challongeParticipantsCount', { count: participants.length }) }}
              </div>
              <div class="row items-center q-gutter-x-xs no-wrap">
                <QBtn
                  outline
                  dense
                  no-caps
                  size="sm"
                  color="primary"
                  icon="shuffle"
                  :label="t('challongeBtnRandomize')"
                  class="no-wrap q-px-sm"
                  :loading="isRandomizing"
                  :disable="participants.length < 2"
                  @click="confirmRandomizeSeeds"
                >
                  <QTooltip class="glass-tooltip">
                    {{ t('challongeRandomizeTitle') }}
                  </QTooltip>
                </QBtn>
                <QBtn
                  flat
                  round
                  dense
                  size="sm"
                  icon="refresh"
                  class="subtle-action-btn text-muted"
                  :loading="loadingParticipants"
                  @click="loadParticipants"
                >
                  <QTooltip class="glass-tooltip">
                    {{ t('tooltipRefreshMatches') }}
                  </QTooltip>
                </QBtn>
              </div>
            </div>

            <!-- PARTICIPANTS LIST -->
            <div class="participant-list-container">
              <div
                v-if="loadingParticipants && participants.length === 0"
                class="row justify-center items-center q-py-lg"
              >
                <QSpinner
                  color="primary"
                  size="2em"
                />
              </div>

              <div
                v-else-if="participants.length === 0"
                class="column items-center justify-center q-py-lg text-center text-muted"
              >
                <QIcon
                  name="person_off"
                  size="36px"
                  class="q-mb-xs"
                />
                <div class="text-caption">
                  {{ t('challongeNoParticipants') }}
                </div>
              </div>

              <QScrollArea
                v-else
                class="participant-scroll-area"
              >
                <div class="column q-gutter-y-xs q-pr-sm">
                  <div
                    v-for="p in sortedParticipants"
                    :key="p.id"
                    class="participant-row row items-center justify-between no-wrap q-px-sm q-py-xs"
                  >
                    <div class="row items-center q-gutter-x-sm no-wrap col min-width-0">
                      <span
                        class="seed-badge font-mono text-weight-bold col-auto"
                        :class="p.seed ? 'seed-active' : 'seed-none'"
                      >
                        #{{ p.seed || '-' }}
                      </span>
                      <span class="text-body2 text-weight-medium text-base ellipsis col">
                        {{ p.gamertag }}
                      </span>
                      <span
                        v-if="p.team"
                        class="text-caption text-grey-5 col-auto"
                      >
                        ({{ p.team }})
                      </span>
                    </div>

                    <div class="col-auto q-ml-sm">
                      <QBtn
                        flat
                        round
                        dense
                        size="sm"
                        icon="delete_outline"
                        color="grey-6"
                        class="delete-btn"
                        :loading="isDeletingId === p.id"
                        @click="confirmDeleteParticipant(p)"
                      >
                        <QTooltip class="glass-tooltip">
                          {{ t('challongeDeleteParticipantTitle') }}
                        </QTooltip>
                      </QBtn>
                    </div>
                  </div>
                </div>
              </QScrollArea>
            </div>
          </div>
        </QTabPanel>

        <!-- TAB 3: BULK ADD -->
        <QTabPanel
          name="bulkAdd"
          class="q-pa-md"
        >
          <div class="column q-gutter-y-sm manage-tab-content">
            <div class="text-caption text-muted">
              {{ t('challongeBulkInstructions') }}
            </div>

            <QInput
              v-model="bulkInputText"
              type="textarea"
              filled
              dense
              rows="7"
              :placeholder="`1 | Daigo\n2 | Tokido\n3 | Justin Wong\n4 | SonicFox`"
              class="dark-input font-mono bulk-textarea"
            />

            <div class="row items-center justify-between no-wrap q-mt-xs">
              <span class="text-caption text-grey-6 font-mono">
                {{ t('challongeBulkFormatHint') }}
              </span>
              <QBtn
                unelevated
                no-caps
                color="primary"
                icon="playlist_add"
                :label="t('challongeBtnAddBulk')"
                class="primary-action-btn no-wrap"
                :loading="isBulkAdding"
                :disable="!bulkInputText.trim()"
                @click="handleBulkAdd"
              />
            </div>
          </div>
        </QTabPanel>
      </QTabPanels>

      <!-- FOOTER -->
      <div class="q-pa-sm row justify-end border-top-subtle">
        <QBtn
          v-close-popup
          flat
          no-caps
          color="secondary"
          :label="t('cancel')"
          class="subtle-action-btn"
        />
      </div>
    </QCard>
  </QDialog>
</template>

<style scoped lang="scss">
.manage-dialog {
  width: 620px;
  max-width: 95vw;
  border-radius: 8px;
  overflow: hidden;
}

.border-bottom-subtle {
  border-bottom: 1px solid var(--border-subtle);
}

.border-top-subtle {
  border-top: 1px solid var(--border-subtle);
}

.tab-panels-fixed {
  min-height: 380px;
  overflow-x: hidden;
}

.manage-tab-content {
  width: 100%;
}

.status-action-card {
  border-radius: 6px;
  background: var(--bg-subtle);
  border: 1px solid var(--border-subtle);
  transition: all 0.2s ease;
  min-height: 68px;

  &:hover {
    border-color: var(--border-medium);
    background: rgba(255, 255, 255, 0.07);
  }

  &.card-disabled {
    opacity: 0.6;
    pointer-events: none;
  }
}

.icon-avatar {
  width: 40px;
  height: 40px;
  border-radius: 8px;
  flex-shrink: 0;

  &.primary-avatar {
    background: rgba(230, 107, 60, 0.12);
    color: var(--q-primary);
    border: 1px solid rgba(230, 107, 60, 0.25);
  }

  &.secondary-avatar {
    background: rgba(244, 162, 97, 0.12);
    color: var(--q-secondary);
    border: 1px solid rgba(244, 162, 97, 0.25);
  }

  &.danger-avatar {
    background: rgba(244, 67, 54, 0.1);
    color: var(--q-negative);
    border: 1px solid rgba(244, 67, 54, 0.25);
  }
}

.action-desc {
  line-height: 1.3;
}

.card-action-btn {
  font-weight: 600;
  font-size: 0.85rem;
  padding: 6px 16px;
  border-radius: 6px;
  transition: all 0.2s ease;
  white-space: nowrap;

  &:active {
    transform: scale(0.96);
  }
}

.participant-list-container {
  height: 250px;
  min-height: 250px;
  max-height: 250px;
  overflow: hidden;
}

.participant-scroll-area {
  height: 250px;
  width: 100%;
}

.participant-row {
  border-radius: 4px;
  background: var(--bg-subtle);
  border: 1px solid var(--border-subtle);
  transition: all 0.15s ease;
  min-height: 34px;

  &:hover {
    border-color: var(--border-medium);
    background: rgba(255, 255, 255, 0.06);

    .delete-btn {
      color: #ff5252 !important;
    }
  }
}

.seed-badge {
  font-size: 0.75rem;
  padding: 2px 6px;
  border-radius: 4px;
  min-width: 32px;
  text-align: center;

  &.seed-active {
    background: rgba(230, 107, 60, 0.18);
    color: var(--q-primary);
    border: 1px solid rgba(230, 107, 60, 0.35);
  }

  &.seed-none {
    background: rgba(255, 255, 255, 0.05);
    color: var(--text-muted);
    border: 1px solid var(--border-subtle);
  }
}

.delete-btn {
  transition: color 0.2s ease;
}

.bulk-textarea {
  font-size: 0.85rem;
}

.min-width-0 {
  min-width: 0;
}
</style>
