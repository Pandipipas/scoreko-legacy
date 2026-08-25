<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useBracketStore } from '../stores/bracket';
import { t } from '../i18n';
import type { BracketStanding } from '../../../types';

defineOptions({ name: 'TournamentStandingsDialog' });

const props = defineProps<{
  modelValue: boolean;
  eventId?: string;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', val: boolean): void;
}>();

const bracketStore = useBracketStore();

const selectedEventId = ref<string>('');

const availableEvents = computed(() => bracketStore.events);

const effectiveEventId = computed(() => {
  if (selectedEventId.value) return selectedEventId.value;
  if (props.eventId) return props.eventId;
  if (bracketStore.startggEventId) return bracketStore.startggEventId;
  if (bracketStore.attached.startggEventId) return bracketStore.attached.startggEventId;
  if (bracketStore.events.length > 0 && bracketStore.events[0]?.id) return String(bracketStore.events[0].id);
  return '';
});

const isDialogOpen = computed({
  get: () => props.modelValue,
  set: (val: boolean) => emit('update:modelValue', val),
});

const loadStandings = async () => {
  const targetId = effectiveEventId.value;
  if (!targetId) return;
  await bracketStore.fetchStartggStandings(targetId);
};

watch(() => props.modelValue, (isOpen) => {
  if (isOpen) {
    if (props.eventId) {
      selectedEventId.value = props.eventId;
    } else if (!selectedEventId.value && effectiveEventId.value) {
      selectedEventId.value = effectiveEventId.value;
    }
    loadStandings();
  }
});

watch(selectedEventId, (newId) => {
  if (newId && props.modelValue) {
    bracketStore.fetchStartggStandings(newId);
  }
});

const standings = computed<BracketStanding[]>(() => bracketStore.standings);

const formatPlacement = (placement: number): string => {
  const rem10 = placement % 10;
  const rem100 = placement % 100;
  if (rem10 === 1 && rem100 !== 11) return `${placement}st`;
  if (rem10 === 2 && rem100 !== 12) return `${placement}nd`;
  if (rem10 === 3 && rem100 !== 13) return `${placement}rd`;
  return `${placement}th`;
};

const getPlacementBadgeClass = (placement: number) => {
  if (placement === 1) return 'placement-gold';
  if (placement === 2) return 'placement-silver';
  if (placement === 3) return 'placement-bronze';
  if (placement <= 8) return 'placement-top8';
  return 'placement-default';
};

const getPodiumMedal = (placement: number): string => {
  if (placement === 1) return '🥇';
  if (placement === 2) return '🥈';
  if (placement === 3) return '🥉';
  return '';
};
</script>

<template>
  <QDialog
    v-model="isDialogOpen"
    backdrop-filter="blur(4px) brightness(60%)"
  >
    <QCard
      flat
      bordered
      class="glass-panel standings-dialog"
    >
      <!-- HEADER -->
      <div class="q-pa-md q-pb-sm row justify-between items-start border-bottom-subtle">
        <div class="row items-center q-gutter-x-sm">
          <QIcon
            name="emoji_events"
            color="primary"
            size="md"
          />
          <div>
            <div class="text-h6 text-weight-bold text-base leading-tight">
              {{ t('standingsTitle') }}
            </div>
            <div class="text-caption text-muted">
              {{ t('standingsSubtitle') }}
            </div>
          </div>
        </div>

        <div class="row items-center q-gutter-x-xs">
          <QBtn
            flat
            round
            dense
            icon="refresh"
            class="subtle-action-btn"
            :loading="bracketStore.loadingStandings"
            @click="loadStandings"
          >
            <QTooltip class="glass-tooltip">
              {{ t('tooltipRefreshStandings') }}
            </QTooltip>
          </QBtn>
          <QBtn
            v-close-popup
            flat
            round
            dense
            icon="close"
            class="subtle-action-btn text-muted"
          />
        </div>
      </div>

      <!-- EVENT SELECTOR (if multiple events exist) -->
      <div
        v-if="availableEvents.length > 1"
        class="q-px-md q-py-sm bg-subtle row items-center justify-between"
      >
        <span class="text-caption text-muted text-weight-medium">
          {{ t('standingsEvent') }}:
        </span>
        <QSelect
          v-model="selectedEventId"
          :options="availableEvents"
          option-value="id"
          option-label="name"
          emit-value
          map-options
          dense
          options-dense
          color="primary"
          popup-content-class="glass-panel glass-dropdown"
          class="dark-input event-selector"
        />
      </div>

      <!-- BODY: CONTENT -->
      <QCardSection class="q-pa-md standings-content-section">
        <!-- LOADING SPINNER -->
        <div
          v-if="bracketStore.loadingStandings && standings.length === 0"
          class="row justify-center items-center q-py-xl"
        >
          <QSpinner
            color="primary"
            size="3em"
          />
        </div>

        <!-- EMPTY STATE -->
        <div
          v-else-if="standings.length === 0"
          class="column items-center justify-center q-py-xl text-center"
        >
          <QIcon
            name="leaderboard"
            size="56px"
            color="grey-8"
            class="q-mb-md"
          />
          <div class="text-subtitle1 text-grey-5 q-mb-xs text-weight-medium">
            {{ t('standingsEmpty') }}
          </div>
          <QBtn
            flat
            no-caps
            color="primary"
            icon="refresh"
            :label="t('tooltipRefreshStandings')"
            class="subtle-action-btn q-mt-sm"
            :loading="bracketStore.loadingStandings"
            @click="loadStandings"
          />
        </div>

        <!-- STANDINGS LIST -->
        <QScrollArea
          v-else
          class="standings-scroll-area"
        >
          <div class="column q-gutter-y-xs q-pr-sm">
            <div
              v-for="item in standings"
              :key="`${item.placement}-${item.entrantId}`"
              class="standing-row row items-center justify-between q-py-xs q-px-sm"
              :class="getPlacementBadgeClass(item.placement)"
            >
              <!-- LEFT: PLACEMENT & MEDAL -->
              <div class="row items-center q-gutter-x-sm no-wrap">
                <div class="placement-indicator row items-center justify-center">
                  <span class="placement-text font-mono text-weight-bold">
                    {{ formatPlacement(item.placement) }}
                  </span>
                  <span
                    v-if="getPodiumMedal(item.placement)"
                    class="medal-icon q-ml-xs"
                  >
                    {{ getPodiumMedal(item.placement) }}
                  </span>
                </div>

                <!-- PLAYER / TEAM NAME -->
                <div class="entrant-info ellipsis">
                  <span class="text-body2 text-weight-bold entrant-name text-base">
                    {{ item.entrantName }}
                  </span>
                </div>
              </div>

              <!-- RIGHT: STATUS (if in progress) -->
              <div class="row items-center">
                <QBadge
                  v-if="item.isPlacementResolved === false"
                  outline
                  color="warning"
                  class="text-caption font-mono"
                >
                  {{ t('standingsInProgress') }}
                </QBadge>
              </div>
            </div>
          </div>
        </QScrollArea>
      </QCardSection>

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
.standings-dialog {
  width: min(560px, 95vw);
  max-width: 560px;
  border-radius: 8px;
}

.border-bottom-subtle {
  border-bottom: 1px solid var(--border-subtle);
}

.border-top-subtle {
  border-top: 1px solid var(--border-subtle);
}

.event-selector {
  min-width: 220px;
  max-width: 320px;
}

.standings-content-section {
  min-height: 260px;
  max-height: 60vh;
  padding: 12px;
}

.standings-scroll-area {
  height: 380px;
  width: 100%;
}

.standing-row {
  border-radius: 6px;
  background: var(--bg-subtle);
  border: 1px solid var(--border-subtle);
  transition: all 0.15s ease;
  min-height: 40px;

  &:hover {
    border-color: var(--border-medium);
    background: rgba(255, 255, 255, 0.07);
  }

  &.placement-gold {
    background: linear-gradient(90deg, rgba(255, 215, 0, 0.15) 0%, rgba(255, 215, 0, 0.04) 100%);
    border: 1px solid rgba(255, 215, 0, 0.4);

    .placement-text {
      color: #ffd700;
      text-shadow: 0 0 8px rgba(255, 215, 0, 0.4);
    }
    .entrant-name {
      color: #ffffff;
      font-weight: 700;
    }
  }

  &.placement-silver {
    background: linear-gradient(90deg, rgba(192, 192, 192, 0.15) 0%, rgba(192, 192, 192, 0.04) 100%);
    border: 1px solid rgba(192, 192, 192, 0.35);

    .placement-text {
      color: #e0e0e0;
    }
    .entrant-name {
      color: #f0f0f0;
      font-weight: 600;
    }
  }

  &.placement-bronze {
    background: linear-gradient(90deg, rgba(205, 127, 50, 0.15) 0%, rgba(205, 127, 50, 0.04) 100%);
    border: 1px solid rgba(205, 127, 50, 0.35);

    .placement-text {
      color: #ffaa66;
    }
    .entrant-name {
      color: #f0f0f0;
      font-weight: 600;
    }
  }

  &.placement-top8 {
    border-left: 3px solid var(--q-primary);

    .placement-text {
      color: var(--q-primary);
    }
  }

  &.placement-default {
    .placement-text {
      color: var(--text-muted);
    }
  }
}

.placement-indicator {
  min-width: 60px;
}

.placement-text {
  font-size: 0.85rem;
}

.medal-icon {
  font-size: 1rem;
  line-height: 1;
}

.entrant-info {
  max-width: 320px;
}

.entrant-name {
  font-size: 0.9rem;
}
</style>
