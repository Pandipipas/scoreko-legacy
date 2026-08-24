<script setup lang="ts">
import { computed, ref, onMounted } from 'vue';
import { useQuasar } from 'quasar';
import type { StreamQueueItem, StreamQueueSet } from '../../../types';
import { useBracketStore } from '../stores/bracket';
import { usePlayersStore } from '../stores/players';
import { useScoreboardStore } from '../stores/scoreboard';
import { CUSTOM_LEFT_PLAYER_ID, CUSTOM_RIGHT_PLAYER_ID } from '../composables/usePlayerSide';
import { t } from '../i18n';

defineOptions({ name: 'TournamentStreamQueueTab' });

const bracketStore = useBracketStore();
const playersStore = usePlayersStore();
const scoreboardStore = useScoreboardStore();
const $q = useQuasar();

const selectedStreamId = ref<string>('all');

onMounted(() => {
  if (bracketStore.provider === 'startgg') {
    bracketStore.fetchStartggStreamQueue();
  }
});

const streams = computed<StreamQueueItem[]>(() => bracketStore.streamQueue);

const totalQueuedSets = computed(() => {
  return streams.value.reduce((acc, item) => acc + (item.sets?.length || 0), 0);
});

const filteredStreams = computed<StreamQueueItem[]>(() => {
  if (selectedStreamId.value === 'all') {
    return streams.value;
  }
  return streams.value.filter((item) => String(item.stream.id) === selectedStreamId.value);
});

const getStreamSourceIcon = (source: string) => {
  const s = (source || '').toLowerCase();
  if (s.includes('twitch')) return 'videocam';
  if (s.includes('youtube') || s.includes('yt')) return 'smart_display';
  return 'live_tv';
};

const getStreamSourceColor = (source: string) => {
  const s = (source || '').toLowerCase();
  if (s.includes('twitch')) return 'purple-4';
  if (s.includes('youtube') || s.includes('yt')) return 'red-5';
  return 'primary';
};

const refreshQueue = async () => {
  await bracketStore.fetchStartggStreamQueue();
};

const coverQueueSet = (set: StreamQueueSet) => {
  if (bracketStore.activeMatchId === set.id) {
    bracketStore.activeMatchId = null;
    $q.notify({ type: 'info', message: t('bracketMatchUncovered') });
    return;
  }

  bracketStore.activeMatchId = set.id;
  const players = playersStore.players;
  const newScoreboard = { ...scoreboardStore.scoreboard };

  if (set.player1) {
    if (players[set.player1.id]) {
      newScoreboard.leftPlayerId = set.player1.id;
      newScoreboard.leftNameOverride = '';
      newScoreboard.leftTeamOverride = '';
      newScoreboard.leftCountryOverride = '';
    } else {
      newScoreboard.leftPlayerId = CUSTOM_LEFT_PLAYER_ID;
      newScoreboard.leftNameOverride = set.player1.gamertag;
      newScoreboard.leftTeamOverride = set.player1.team ?? '';
      newScoreboard.leftCountryOverride = '';
    }
    newScoreboard.leftScore = 0;
  }

  if (set.player2) {
    if (players[set.player2.id]) {
      newScoreboard.rightPlayerId = set.player2.id;
      newScoreboard.rightNameOverride = '';
      newScoreboard.rightTeamOverride = '';
      newScoreboard.rightCountryOverride = '';
    } else {
      newScoreboard.rightPlayerId = CUSTOM_RIGHT_PLAYER_ID;
      newScoreboard.rightNameOverride = set.player2.gamertag;
      newScoreboard.rightTeamOverride = set.player2.team ?? '';
      newScoreboard.rightCountryOverride = '';
    }
    newScoreboard.rightScore = 0;
  }

  newScoreboard.leftBracketStatus = '';
  newScoreboard.rightBracketStatus = '';
  newScoreboard.round = set.fullRoundText;
  scoreboardStore.setScoreboard(newScoreboard);

  $q.notify({ type: 'positive', message: t('bracketMatchCovered') });
};
</script>

<template>
  <div class="stream-queue-tab">
    <!-- TOP TOOLBAR -->
    <div class="row items-center justify-between panel-header q-mb-md">
      <div class="row items-center q-gutter-sm">
        <div class="text-h6 row items-center">
          <QIcon
            name="live_tv"
            color="primary"
            size="sm"
            class="q-mr-xs"
          />
          {{ t('streamQueueTitle') }}
        </div>
        <QBadge
          v-if="totalQueuedSets > 0"
          color="primary"
          rounded
          class="q-ml-xs text-weight-bold"
        >
          {{ totalQueuedSets }}
        </QBadge>
      </div>

      <div class="row items-center q-gutter-sm">
        <QBtn
          icon="refresh"
          flat
          round
          dense
          class="subtle-action-btn"
          :loading="bracketStore.loadingStreamQueue"
          @click="refreshQueue"
        >
          <QTooltip class="glass-tooltip">
            {{ t('streamQueueRefresh') }}
          </QTooltip>
        </QBtn>
      </div>
    </div>

    <!-- STREAM FILTER TABS (if multiple streams exist) -->
    <div
      v-if="streams.length > 1"
      class="q-mb-lg stream-filter-bar"
    >
      <QTabs
        v-model="selectedStreamId"
        dense
        no-caps
        active-color="primary"
        indicator-color="primary"
        align="left"
        class="glass-panel stream-tabs"
      >
        <QTab
          name="all"
          :label="t('streamQueueAllStreams')"
        >
          <QBadge
            color="grey-8"
            text-color="grey-3"
            rounded
            class="q-ml-xs"
          >
            {{ totalQueuedSets }}
          </QBadge>
        </QTab>
        <QTab
          v-for="item in streams"
          :key="item.stream.id"
          :name="String(item.stream.id)"
        >
          <div class="row items-center no-wrap">
            <QIcon
              :name="getStreamSourceIcon(item.stream.streamSource)"
              :color="getStreamSourceColor(item.stream.streamSource)"
              size="16px"
              class="q-mr-xs"
            />
            <span>{{ item.stream.streamName }}</span>
            <QBadge
              v-if="item.sets?.length"
              color="primary"
              rounded
              class="q-ml-xs"
            >
              {{ item.sets.length }}
            </QBadge>
          </div>
        </QTab>
      </QTabs>
    </div>

    <!-- LOADING STATE -->
    <div
      v-if="bracketStore.loadingStreamQueue && !streams.length"
      class="row justify-center items-center q-pa-xl"
    >
      <QSpinner
        color="primary"
        size="3em"
      />
    </div>

    <!-- EMPTY STATE -->
    <div
      v-else-if="!streams.length || totalQueuedSets === 0"
      class="column items-center justify-center q-py-xl glass-panel empty-queue-panel text-center"
    >
      <QIcon
        name="live_tv"
        size="64px"
        color="grey-8"
        class="q-mb-md"
      />
      <div class="text-h6 text-grey-5 q-mb-xs">
        {{ t('streamQueueEmpty') }}
      </div>
      <div class="text-caption text-grey-6 q-mb-lg max-width-caption">
        {{ t('streamQueueSubtitle') }}
      </div>
      <QBtn
        unelevated
        no-caps
        color="primary"
        icon="refresh"
        :label="t('streamQueueRefresh')"
        class="primary-action-btn"
        :loading="bracketStore.loadingStreamQueue"
        @click="refreshQueue"
      />
    </div>

    <!-- STREAM QUEUE STATIONS LIST -->
    <div
      v-else
      class="column q-gutter-y-lg"
    >
      <div
        v-for="streamItem in filteredStreams"
        :key="streamItem.stream.id"
        class="stream-station-block"
      >
        <!-- STREAM HEADER CARD -->
        <div class="stream-station-header row items-center justify-between q-py-sm q-px-md glass-panel q-mb-sm">
          <div class="row items-center q-gutter-sm">
            <QIcon
              :name="getStreamSourceIcon(streamItem.stream.streamSource)"
              :color="getStreamSourceColor(streamItem.stream.streamSource)"
              size="20px"
            />
            <span class="text-subtitle1 text-weight-bold text-base">
              {{ streamItem.stream.streamName }}
            </span>
            <QBadge
              outline
              :color="getStreamSourceColor(streamItem.stream.streamSource)"
              class="text-uppercase text-caption"
            >
              {{ streamItem.stream.streamSource }}
            </QBadge>
          </div>

          <div class="text-caption text-muted">
            {{ streamItem.sets?.length === 1 ? t('streamQueueMatchSingular') : t('streamQueueMatchPlural', { count: streamItem.sets?.length || 0 }) }}
          </div>
        </div>

        <!-- SETS FOR THIS STREAM -->
        <div
          v-if="!streamItem.sets?.length"
          class="q-pa-md glass-panel text-center text-grey-6"
        >
          {{ t('streamQueueNoSetsForStream') }}
        </div>

        <div
          v-else
          class="queue-sets-grid"
        >
          <QCard
            v-for="set in streamItem.sets"
            :key="set.id"
            class="match-queue-card glass-panel"
            :class="{ 'active-match-border': bracketStore.activeMatchId === set.id }"
          >
            <div class="match-card-top-border" />

            <!-- CARD HEADER: EVENT & ROUND -->
            <QCardSection class="q-py-sm q-px-md">
              <div class="row items-center justify-between no-wrap q-gutter-xs">
                <div class="text-caption text-primary ellipsis text-weight-medium">
                  {{ set.event?.name }}
                </div>
                <QBadge
                  v-if="set.identifier"
                  dense
                  color="grey-9"
                  text-color="grey-4"
                  class="font-mono text-weight-bold"
                >
                  {{ set.identifier }}
                </QBadge>
              </div>
              <div class="text-subtitle2 text-weight-medium text-grey-3 ellipsis q-mt-xs">
                {{ set.fullRoundText }}
              </div>
            </QCardSection>

            <!-- CARD PLAYERS -->
            <QCardSection class="q-pt-none q-pb-sm q-px-md">
              <div
                class="match-players-box"
                :class="{ 'active-match-border': bracketStore.activeMatchId === set.id }"
              >
                <!-- PLAYER 1 -->
                <div class="row items-center justify-between player-row q-px-sm q-py-xs no-wrap">
                  <div class="row items-center ellipsis no-wrap">
                    <span
                      v-if="set.player1?.team"
                      class="team-prefix text-grey-5 q-mr-xs"
                    >{{ set.player1.team }}</span>
                    <span class="gamertag-text ellipsis text-weight-medium">
                      {{ set.player1?.gamertag || 'TBD' }}
                    </span>
                  </div>
                </div>

                <QSeparator />

                <!-- PLAYER 2 -->
                <div class="row items-center justify-between player-row q-px-sm q-py-xs no-wrap">
                  <div class="row items-center ellipsis no-wrap">
                    <span
                      v-if="set.player2?.team"
                      class="team-prefix text-grey-5 q-mr-xs"
                    >{{ set.player2.team }}</span>
                    <span class="gamertag-text ellipsis text-weight-medium">
                      {{ set.player2?.gamertag || 'TBD' }}
                    </span>
                  </div>
                </div>
              </div>
            </QCardSection>

            <!-- CARD ACTIONS -->
            <QCardSection class="q-py-xs q-px-md bg-subtle">
              <div class="row items-center justify-between">
                <QBtn
                  v-if="bracketStore.activeMatchId === set.id"
                  unelevated
                  dense
                  no-caps
                  size="sm"
                  color="positive"
                  icon="check"
                  :label="t('streamQueueActiveOnScoreboard')"
                  class="full-width"
                  @click="coverQueueSet(set)"
                />
                <QBtn
                  v-else
                  unelevated
                  dense
                  no-caps
                  size="sm"
                  color="primary"
                  icon="live_tv"
                  :label="t('streamQueueSendToScoreboard')"
                  class="full-width primary-action-btn"
                  @click="coverQueueSet(set)"
                />
              </div>
            </QCardSection>
          </QCard>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.stream-queue-tab {
  width: 100%;
}

.empty-queue-panel {
  border-radius: 8px;
  min-height: 260px;
}

.max-width-caption {
  max-width: 400px;
}

.stream-station-header {
  border-radius: 6px;
  border-left: 3px solid var(--q-primary);
}

.stream-tabs {
  border-radius: 6px;
}

.queue-sets-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 16px;
}

.match-queue-card {
  position: relative;
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  border: 1px solid var(--border-subtle);
  transition: transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;

  &:hover {
    border-color: var(--border-medium);
    transform: translateY(-2px);
  }

  &.active-match-border {
    border-color: var(--q-primary);
    box-shadow: 0 0 12px rgba(230, 107, 60, 0.25);
  }
}

.match-card-top-border {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--q-primary);
  opacity: 0.8;
}

.match-players-box {
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid var(--border-subtle);
  border-radius: 4px;
  overflow: hidden;
}

.player-row {
  height: 32px;
}

.team-prefix {
  font-family: var(--font-mono);
  font-size: 0.75rem;
}

.gamertag-text {
  color: var(--text-base);
  font-size: 0.85rem;
}

.primary-action-btn {
  font-weight: 500;
}
</style>
