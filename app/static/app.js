(function () {
  const DEFAULT_ZOOM = 40;
  const ZOOM_STEP = 30;
  const MIN_ZOOM = 10;
  const MIN_REGION_SPAN = 0.1;
  const ROUND_TRANSITION_TITLES = {
    2: "Round 2 — Reverse",
    3: "Round 3 — Escalation",
  };

  function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
  }

  function formatTime(value) {
    if (!Number.isFinite(value)) {
      return "--:--.-";
    }

    const minutes = Math.floor(value / 60);
    const seconds = value - minutes * 60;
    return `${String(minutes).padStart(2, "0")}:${seconds
      .toFixed(1)
      .padStart(4, "0")}`;
  }

  function formatDuration(value) {
    if (!Number.isFinite(value)) {
      return "--.-s";
    }

    return `${value.toFixed(1)}s`;
  }

  function formatCardDuration(start, duration) {
    return `Start: ${formatTime(start)}  Duration: ${formatDuration(duration)}`;
  }

  function formatCountdown(value) {
    return `${Math.max(0, value).toFixed(1)}s`;
  }

  function normalizeText(value) {
    return `${value || ""}`.trim();
  }

  function numberOrNull(value) {
    if (value === "" || value === null || value === undefined) {
      return null;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function createEmitter() {
    const listeners = new Map();
    return {
      on(eventName, handler) {
        if (!listeners.has(eventName)) {
          listeners.set(eventName, []);
        }
        listeners.get(eventName).push(handler);
      },
      emit(eventName, ...args) {
        for (const handler of listeners.get(eventName) || []) {
          handler(...args);
        }
      },
    };
  }

  function shuffleList(items) {
    const shuffled = items.slice();
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }
    return shuffled;
  }

  function createWaveSurferFallback() {
    class FallbackWaveSurfer {
      constructor(options) {
        this.options = options;
        this.container =
          typeof options.container === "string"
            ? document.querySelector(options.container)
            : options.container;
        this.emitter = createEmitter();
        this.plugins = [];
        this.pxPerSec = DEFAULT_ZOOM;
        this.audio = new Audio();
        this.audio.preload = "metadata";
        this.destroyed = false;
        this.duration = 0;
        this.resizeObserver = null;
        this.handleTrackClick = this.handleTrackClick.bind(this);
        this.handleTimeUpdate = this.handleTimeUpdate.bind(this);
        this.handleLoadedMetadata = this.handleLoadedMetadata.bind(this);
        this.handleAudioError = this.handleAudioError.bind(this);
        this.setupDom();
        this.bindAudioEvents();
      }

      setupDom() {
        this.container.innerHTML = "";
        this.scroll = document.createElement("div");
        this.scroll.className = "waveform-scroll";
        this.track = document.createElement("div");
        this.track.className = "waveform-track";
        this.progress = document.createElement("div");
        this.progress.className = "waveform-progress";
        this.track.appendChild(this.progress);
        this.scroll.appendChild(this.track);
        this.container.appendChild(this.scroll);
        this.track.addEventListener("click", this.handleTrackClick);

        if ("ResizeObserver" in window) {
          this.resizeObserver = new ResizeObserver(() => this.render());
          this.resizeObserver.observe(this.container);
        }
      }

      bindAudioEvents() {
        this.audio.addEventListener("timeupdate", this.handleTimeUpdate);
        this.audio.addEventListener("loadedmetadata", this.handleLoadedMetadata);
        this.audio.addEventListener("durationchange", this.handleLoadedMetadata);
        this.audio.addEventListener("error", this.handleAudioError);
      }

      handleTrackClick(event) {
        const rect = this.track.getBoundingClientRect();
        if (rect.width === 0) {
          return;
        }

        const progress = clamp((event.clientX - rect.left) / rect.width, 0, 1);
        this.seekTo(progress);
      }

      handleTimeUpdate() {
        this.updateProgress();
        this.emitter.emit("timeupdate", this.getCurrentTime());
      }

      handleLoadedMetadata() {
        this.duration = Number.isFinite(this.audio.duration) ? this.audio.duration : 0;
        this.render();
        this.emitter.emit("ready");
      }

      handleAudioError() {
        this.emitter.emit("error", new Error("Audio unavailable"));
      }

      render() {
        const width = Math.max(
          this.container.clientWidth || 0,
          (this.duration || 1) * this.pxPerSec
        );
        this.track.style.width = `${width}px`;
        this.track.style.height = `${this.options.height || 120}px`;
        this.updateProgress();
        for (const plugin of this.plugins) {
          if (typeof plugin.refresh === "function") {
            plugin.refresh();
          }
        }
      }

      updateProgress() {
        if (!this.duration) {
          this.progress.style.width = "0";
          return;
        }

        const ratio = clamp(this.audio.currentTime / this.duration, 0, 1);
        this.progress.style.width = `${ratio * 100}%`;
      }

      load(url) {
        this.audio.pause();
        this.audio.src = url;
        this.audio.load();
      }

      registerPlugin(plugin) {
        plugin.init(this);
        this.plugins.push(plugin);
        return plugin;
      }

      on(eventName, handler) {
        this.emitter.on(eventName, handler);
      }

      playPause() {
        if (this.audio.paused) {
          this.audio.play().catch(() => {});
          return;
        }

        this.audio.pause();
      }

      seekTo(progress) {
        if (!this.duration) {
          return;
        }

        this.audio.currentTime = this.duration * clamp(progress, 0, 1);
        this.updateProgress();
        this.emitter.emit("timeupdate", this.getCurrentTime());
      }

      zoom(pixelsPerSecond) {
        this.pxPerSec = Math.max(MIN_ZOOM, pixelsPerSecond);
        this.render();
      }

      getCurrentTime() {
        return this.audio.currentTime || 0;
      }

      getDuration() {
        return this.duration || 0;
      }

      getTrackElement() {
        return this.track;
      }

      destroy() {
        if (this.destroyed) {
          return;
        }

        this.destroyed = true;
        this.audio.pause();
        this.audio.removeEventListener("timeupdate", this.handleTimeUpdate);
        this.audio.removeEventListener("loadedmetadata", this.handleLoadedMetadata);
        this.audio.removeEventListener("durationchange", this.handleLoadedMetadata);
        this.audio.removeEventListener("error", this.handleAudioError);
        this.track.removeEventListener("click", this.handleTrackClick);
        for (const plugin of this.plugins) {
          if (typeof plugin.destroy === "function") {
            plugin.destroy();
          }
        }
        if (this.resizeObserver !== null) {
          this.resizeObserver.disconnect();
        }
        this.container.innerHTML = "";
      }
    }

    return {
      create(options) {
        return new FallbackWaveSurfer(options);
      },
    };
  }

  function createRegionsFallback() {
    class FallbackRegion {
      constructor(plugin, options) {
        this.plugin = plugin;
        this.start = 0;
        this.end = 0;
        this.drag = options.drag !== false;
        this.resize = options.resize !== false;
        this.pending = Boolean(options.pending);
        this.pointerState = null;
        this.handlePointerMove = this.handlePointerMove.bind(this);
        this.handlePointerUp = this.handlePointerUp.bind(this);
        this.element = document.createElement("div");
        this.element.className = "waveform-region";
        this.leftHandle = document.createElement("div");
        this.leftHandle.className = "region-handle start";
        this.rightHandle = document.createElement("div");
        this.rightHandle.className = "region-handle end";
        this.element.appendChild(this.leftHandle);
        this.element.appendChild(this.rightHandle);
        this.attachEvents();
        this.setOptions(options, false);
      }

      attachEvents() {
        this.element.addEventListener("pointerdown", (event) => {
          event.stopPropagation();
          if (!this.plugin.wavesurfer.getDuration()) {
            return;
          }

          let mode = "move";
          if (event.target === this.leftHandle && this.resize) {
            mode = "resize-start";
          } else if (event.target === this.rightHandle && this.resize) {
            mode = "resize-end";
          } else if (!this.drag) {
            return;
          }

          this.pointerState = {
            mode,
            pointerId: event.pointerId,
            originX: event.clientX,
            initialStart: this.start,
            initialEnd: this.end,
          };
          this.element.classList.add("is-dragging");
          document.addEventListener("pointermove", this.handlePointerMove);
          document.addEventListener("pointerup", this.handlePointerUp);
        });
      }

      handlePointerMove(event) {
        if (this.pointerState === null || event.pointerId !== this.pointerState.pointerId) {
          return;
        }

        const track = this.plugin.wavesurfer.getTrackElement();
        const rect = track.getBoundingClientRect();
        const duration = this.plugin.wavesurfer.getDuration() || 1;
        if (rect.width === 0) {
          return;
        }

        const deltaSec = ((event.clientX - this.pointerState.originX) / rect.width) * duration;
        if (this.pointerState.mode === "move") {
          this.setOptions(
            {
              start: this.pointerState.initialStart + deltaSec,
              end: this.pointerState.initialEnd + deltaSec,
            },
            true
          );
          return;
        }

        if (this.pointerState.mode === "resize-start") {
          this.setOptions(
            {
              start: this.pointerState.initialStart + deltaSec,
              end: this.pointerState.initialEnd,
            },
            true
          );
          return;
        }

        this.setOptions(
          {
            start: this.pointerState.initialStart,
            end: this.pointerState.initialEnd + deltaSec,
          },
          true
        );
      }

      handlePointerUp() {
        this.element.classList.remove("is-dragging");
        document.removeEventListener("pointermove", this.handlePointerMove);
        document.removeEventListener("pointerup", this.handlePointerUp);
        this.pointerState = null;
        this.plugin.emitter.emit("region-update-end", this);
      }

      constrain(start, end) {
        const duration = this.plugin.wavesurfer.getDuration();
        let nextStart = Math.max(0, start);
        let nextEnd = end;

        if (Number.isFinite(duration) && duration > 0) {
          nextStart = Math.min(nextStart, duration - MIN_REGION_SPAN);
          nextEnd = Math.min(nextEnd, duration);
        }

        if (nextEnd <= nextStart) {
          nextEnd = nextStart + MIN_REGION_SPAN;
        }

        if (Number.isFinite(duration) && duration > 0 && nextEnd > duration) {
          nextEnd = duration;
          nextStart = Math.max(0, nextEnd - MIN_REGION_SPAN);
        }

        return { start: nextStart, end: nextEnd };
      }

      setOptions(options, emitUpdate) {
        const constrained = this.constrain(
          Number.isFinite(options.start) ? options.start : this.start,
          Number.isFinite(options.end) ? options.end : this.end
        );
        this.start = constrained.start;
        this.end = constrained.end;
        if (Object.hasOwn(options, "pending")) {
          this.pending = Boolean(options.pending);
        }
        if (Object.hasOwn(options, "drag")) {
          this.drag = Boolean(options.drag);
        }
        if (Object.hasOwn(options, "resize")) {
          this.resize = Boolean(options.resize);
        }
        this.render();
        if (emitUpdate) {
          this.plugin.emitter.emit("region-updated", this);
        }
      }

      render() {
        const track = this.plugin.wavesurfer.getTrackElement();
        const duration = this.plugin.wavesurfer.getDuration() || 1;
        const trackWidth = track.getBoundingClientRect().width || track.clientWidth || 1;
        const left = (this.start / duration) * trackWidth;
        const width = Math.max(((this.end - this.start) / duration) * trackWidth, 2);
        this.element.style.left = `${left}px`;
        this.element.style.width = `${width}px`;
        this.element.classList.toggle("pending", this.pending);
        this.leftHandle.hidden = !this.resize;
        this.rightHandle.hidden = !this.resize;
      }

      mount() {
        this.plugin.wavesurfer.getTrackElement().appendChild(this.element);
        this.render();
      }

      remove() {
        this.element.remove();
      }
    }

    class FallbackRegionsPlugin {
      constructor() {
        this.emitter = createEmitter();
        this.region = null;
        this.wavesurfer = null;
      }

      init(wavesurfer) {
        this.wavesurfer = wavesurfer;
      }

      on(eventName, handler) {
        this.emitter.on(eventName, handler);
      }

      addRegion(options) {
        this.clearRegions();
        this.region = new FallbackRegion(this, options);
        this.region.mount();
        return this.region;
      }

      clearRegions() {
        if (this.region !== null) {
          this.region.remove();
          this.region = null;
        }
      }

      refresh() {
        if (this.region !== null) {
          this.region.render();
        }
      }

      destroy() {
        this.clearRegions();
      }
    }

    return {
      create() {
        return new FallbackRegionsPlugin();
      },
    };
  }

  const WaveSurfer = window.WaveSurfer || createWaveSurferFallback();
  const Regions = window.Regions || createRegionsFallback();

  class BlindUpApp {
    constructor() {
      this.elements = {
        pageTitle: document.getElementById("page-title"),
        title: document.getElementById("blindtest-title"),
        saveButton: document.getElementById("save-button"),
        launchButton: document.getElementById("launch-button"),
        gameMode: Array.from(document.querySelectorAll('input[name="game-mode"]')),
        prePlayDelay: document.getElementById("pre-play-delay"),
        autoEnabledDefault: document.getElementById("auto-enabled-default"),
        hintsEnabledDefault: document.getElementById("hints-enabled-default"),
        answerTimerEnabled: document.getElementById("answer-timer-enabled"),
        answerDuration: document.getElementById("answer-duration"),
        round3StepDurations: document.getElementById("round3-step-durations"),
        round3StepGap: document.getElementById("round3-step-gap"),
        round3ProgressionMode: Array.from(
          document.querySelectorAll('input[name="round3-progression-mode"]')
        ),
        editorLayout: document.querySelector(".editor-layout"),
        songList: document.getElementById("song-list"),
        songEditorEmpty: document.getElementById("song-editor-empty"),
        songEditorContent: document.getElementById("song-editor-content"),
        metadataForm: document.getElementById("song-metadata-form"),
        overrideTitle: document.getElementById("override-title"),
        overrideArtist: document.getElementById("override-artist"),
        overrideAlbum: document.getElementById("override-album"),
        overrideYear: document.getElementById("override-year"),
        overrideGenre: document.getElementById("override-genre"),
        overrideCover: document.getElementById("override-cover"),
        customHint: document.getElementById("custom-hint"),
        librarySearch: document.getElementById("library-search"),
        libraryList: document.getElementById("library-list"),
        error: document.getElementById("audio-error"),
        waveform: document.getElementById("waveform"),
        playPause: document.getElementById("play-pause-button"),
        zoomOut: document.getElementById("zoom-out-button"),
        zoomIn: document.getElementById("zoom-in-button"),
        zoomReset: document.getElementById("zoom-reset-button"),
        mark: document.getElementById("mark-button"),
        reset: document.getElementById("reset-selection-button"),
        currentTime: document.getElementById("current-time"),
        startTime: document.getElementById("start-time"),
        endTime: document.getElementById("end-time"),
        duration: document.getElementById("selection-duration"),
      };
      this.playerElements = {
        layout: document.getElementById("player-layout"),
        backButton: document.getElementById("player-back-button"),
        autoButton: document.getElementById("player-auto-button"),
        hintsButton: document.getElementById("player-hints-button"),
        prevButton: document.getElementById("player-prev-button"),
        nextButton: document.getElementById("player-next-button"),
        stepButton: document.getElementById("player-step-button"),
        background: document.getElementById("player-background"),
        roundLabel: document.getElementById("player-round-label"),
        position: document.getElementById("player-position"),
        panelLabel: document.getElementById("player-panel-label"),
        mainTitle: document.getElementById("player-main-title"),
        subtitle: document.getElementById("player-subtitle"),
        countdown: document.getElementById("player-countdown"),
        error: document.getElementById("player-error"),
        hints: document.getElementById("player-hints"),
        answer: document.getElementById("player-answer"),
        cover: document.getElementById("player-cover"),
        answerTitle: document.getElementById("player-answer-title"),
        answerArtist: document.getElementById("player-answer-artist"),
        answerAlbum: document.getElementById("player-answer-album"),
        answerYear: document.getElementById("player-answer-year"),
        answerGenre: document.getElementById("player-answer-genre"),
      };
      this.currentView = "editor";
      this.librarySongs = [];
      this.librarySongMap = new Map();
      this.blindtest = this.createDefaultBlindtest();
      this.activeSlotId = null;
      this.nextSlotId = 1;
      this.currentZoom = DEFAULT_ZOOM;
      this.pendingStart = null;
      this.selectionEnd = null;
      this.currentLoadedSongId = null;
      this.wavesurfer = null;
      this.regions = null;
      this.playerState = null;
      this.playerHistory = [];
      this.playerSongs = [];
      this.playerOrders = { 1: [], 2: [], 3: [] };
      this.playerPanelToken = 0;
      this.playerHintDefinitions = [];
      this.playerHintRevealCount = 0;
      this.playerCountdownInterval = null;
      this.playerHintInterval = null;
      this.playerPrePlayTimeout = null;
      this.playerAutoTimeout = null;
      this.playerAudio = new Audio();
      this.playerAudio.preload = "auto";
      this.playerAudioCleanup = null;
      this.playerReverseSource = null;
      this.playerAudioContext = null;
      this.bindForm();
      this.bindPlayerControls();
      this.showEditorEmpty();
      this.showEditorView();
      this.setWaveformControlsDisabled(true);
      this.showPlaceholder("Select a song card");
    }

    createDefaultBlindtest() {
      return {
        id: null,
        title: "",
        background_image: null,
        game_mode: "blind_test",
        pre_play_delay_sec: 0,
        auto_enabled_default: false,
        hints_enabled_default: true,
        answer_timer_enabled: false,
        answer_duration_sec: 10,
        round3_step_durations: "0.5,1,1.5,2,3,4,5",
        round3_step_gap_sec: 3,
        round3_progression_mode: "fixed_start",
        songs: [],
      };
    }

    bindForm() {
      this.elements.title.addEventListener("input", () => {
        this.blindtest.title = this.elements.title.value;
      });
      for (const input of this.elements.gameMode) {
        input.addEventListener("change", () => {
          if (input.checked) {
            this.blindtest.game_mode = input.value;
          }
        });
      }
      this.elements.prePlayDelay.addEventListener("input", () => {
        this.blindtest.pre_play_delay_sec = numberOrNull(this.elements.prePlayDelay.value) ?? 0;
      });
      this.elements.autoEnabledDefault.addEventListener("change", () => {
        this.blindtest.auto_enabled_default = this.elements.autoEnabledDefault.checked;
      });
      this.elements.hintsEnabledDefault.addEventListener("change", () => {
        this.blindtest.hints_enabled_default = this.elements.hintsEnabledDefault.checked;
      });
      this.elements.answerTimerEnabled.addEventListener("change", () => {
        this.blindtest.answer_timer_enabled = this.elements.answerTimerEnabled.checked;
      });
      this.elements.answerDuration.addEventListener("input", () => {
        this.blindtest.answer_duration_sec = numberOrNull(this.elements.answerDuration.value) ?? 0;
      });
      this.elements.round3StepDurations.addEventListener("input", () => {
        this.blindtest.round3_step_durations = this.elements.round3StepDurations.value;
      });
      this.elements.round3StepGap.addEventListener("input", () => {
        this.blindtest.round3_step_gap_sec = numberOrNull(this.elements.round3StepGap.value) ?? 0;
      });
      for (const input of this.elements.round3ProgressionMode) {
        input.addEventListener("change", () => {
          if (input.checked) {
            this.blindtest.round3_progression_mode = input.value;
          }
        });
      }
      this.elements.saveButton.addEventListener("click", () => {
        this.saveBlindtest().catch(() => {});
      });
      this.elements.launchButton.addEventListener("click", () => {
        this.launchPlayer();
      });
      this.elements.librarySearch.addEventListener("input", () => this.renderLibrary());
      this.elements.metadataForm.addEventListener("input", (event) => {
        this.handleMetadataInput(event);
      });
      this.elements.playPause.addEventListener("click", () => {
        if (this.wavesurfer !== null) {
          this.wavesurfer.playPause();
        }
      });
      this.elements.zoomOut.addEventListener("click", () => this.setZoom(this.currentZoom - ZOOM_STEP));
      this.elements.zoomIn.addEventListener("click", () => this.setZoom(this.currentZoom + ZOOM_STEP));
      this.elements.zoomReset.addEventListener("click", () => this.setZoom(DEFAULT_ZOOM));
      this.elements.mark.addEventListener("click", () => this.handleMark());
      this.elements.reset.addEventListener("click", () => this.resetSelection());
    }

    bindPlayerControls() {
      this.playerElements.backButton.addEventListener("click", () => this.showEditorView());
      this.playerElements.autoButton.addEventListener("click", () => this.togglePlayerAuto());
      this.playerElements.hintsButton.addEventListener("click", () => this.togglePlayerHints());
      this.playerElements.prevButton.addEventListener("click", () => this.handlePlayerPrevious());
      this.playerElements.nextButton.addEventListener("click", () => this.handlePlayerNext());
      this.playerElements.stepButton.addEventListener("click", () => this.advanceRound3Step());
      document.addEventListener("keydown", (event) => this.handlePlayerKeydown(event));
    }

    async init() {
      const [songsResponse, blindtestResponse] = await Promise.all([
        fetch("/api/songs"),
        fetch("/api/blindtest"),
      ]);
      const songsPayload = await songsResponse.json();
      const blindtestPayload = await blindtestResponse.json();
      this.librarySongs = songsPayload.songs || [];
      this.librarySongMap = new Map(this.librarySongs.map((song) => [song.id, song]));
      this.hydrateBlindtest(blindtestPayload.blindtest);
      this.renderAll();
    }

    hydrateBlindtest(data) {
      this.blindtest = this.createDefaultBlindtest();
      if (data !== null && data !== undefined) {
        this.blindtest.id = data.id;
        this.blindtest.title = data.title || "";
        this.blindtest.background_image = normalizeText(data.background_image) || null;
        this.blindtest.game_mode = data.game_mode || "blind_test";
        this.blindtest.pre_play_delay_sec = data.pre_play_delay_sec ?? 0;
        this.blindtest.auto_enabled_default = Boolean(data.auto_enabled_default);
        this.blindtest.hints_enabled_default = Boolean(data.hints_enabled_default);
        this.blindtest.answer_timer_enabled = Boolean(data.answer_timer_enabled);
        this.blindtest.answer_duration_sec = data.answer_duration_sec ?? 10;
        this.blindtest.round3_step_durations =
          data.round3_step_durations || "0.5,1,1.5,2,3,4,5";
        this.blindtest.round3_step_gap_sec = data.round3_step_gap_sec ?? 3;
        this.blindtest.round3_progression_mode =
          data.round3_progression_mode || "fixed_start";
        this.blindtest.songs = (data.songs || []).map((song) => ({
          slot_id: song.id || this.nextSlotId++,
          song_id: song.song_id,
          order_index: song.order_index ?? 0,
          start_sec: song.start_sec,
          duration_sec: song.duration_sec,
          override_title: song.override_title || "",
          override_artist: song.override_artist || "",
          override_album: song.override_album || "",
          override_year: song.override_year ?? "",
          override_genre: song.override_genre || "",
          override_cover: song.override_cover || "",
          custom_hint: song.custom_hint || "",
        }));
        const maxSlotId = this.blindtest.songs.reduce(
          (current, song) => Math.max(current, song.slot_id),
          0
        );
        this.nextSlotId = Math.max(this.nextSlotId, maxSlotId + 1);
      }
      this.reindexSongs();
      this.activeSlotId = this.blindtest.songs.length > 0 ? this.blindtest.songs[0].slot_id : null;
    }

    renderAll() {
      this.renderSettings();
      this.renderSongList();
      this.renderLibrary();
      this.renderEditor();
    }

    renderSettings() {
      this.elements.title.value = this.blindtest.title;
      this.elements.prePlayDelay.value = this.blindtest.pre_play_delay_sec;
      this.elements.autoEnabledDefault.checked = this.blindtest.auto_enabled_default;
      this.elements.hintsEnabledDefault.checked = this.blindtest.hints_enabled_default;
      this.elements.answerTimerEnabled.checked = this.blindtest.answer_timer_enabled;
      this.elements.answerDuration.value = this.blindtest.answer_duration_sec;
      this.elements.round3StepDurations.value = this.blindtest.round3_step_durations;
      this.elements.round3StepGap.value = this.blindtest.round3_step_gap_sec;
      for (const input of this.elements.gameMode) {
        input.checked = input.value === this.blindtest.game_mode;
      }
      for (const input of this.elements.round3ProgressionMode) {
        input.checked = input.value === this.blindtest.round3_progression_mode;
      }
    }

    renderSongList() {
      this.elements.songList.innerHTML = "";
      for (const slot of this.blindtest.songs) {
        const source = this.librarySongMap.get(slot.song_id);
        const card = document.createElement("article");
        card.className = "song-card";
        card.draggable = true;
        card.dataset.slotId = String(slot.slot_id);
        if (slot.slot_id === this.activeSlotId) {
          card.classList.add("active");
        }

        const cover = this.createCoverThumb(source);
        const body = document.createElement("div");
        const title = normalizeText(slot.override_title) || normalizeText(source && source.title) || `Song ${slot.song_id}`;
        const artist = normalizeText(slot.override_artist) || normalizeText(source && source.artist);
        body.innerHTML = `
          <div class="song-card-header">
            <div class="song-card-meta">
              <div class="song-card-title">${this.escapeHtml(title)}</div>
              <div class="song-card-subtitle">${this.escapeHtml(artist || "Unknown artist")}</div>
            </div>
          </div>
          <div class="song-card-times">${this.escapeHtml(
            formatCardDuration(slot.start_sec, slot.duration_sec)
          )}</div>
          <div class="song-card-actions">
            <button type="button" data-action="edit">Edit</button>
            <button type="button" data-action="remove">Remove</button>
          </div>
        `;
        card.appendChild(cover);
        card.appendChild(body);
        card.addEventListener("click", (event) => {
          const action = event.target.closest("button");
          if (action !== null) {
            if (action.dataset.action === "edit") {
              this.setActiveSlot(slot.slot_id);
            }
            if (action.dataset.action === "remove") {
              this.removeSlot(slot.slot_id);
            }
            event.stopPropagation();
            return;
          }
          this.setActiveSlot(slot.slot_id);
        });
        card.addEventListener("dragstart", (event) => {
          card.classList.add("is-dragging");
          event.dataTransfer.setData("text/plain", String(slot.slot_id));
          event.dataTransfer.setData("application/x-blindup-slot", String(slot.slot_id));
          event.dataTransfer.effectAllowed = "move";
        });
        card.addEventListener("dragend", () => {
          card.classList.remove("is-dragging");
          card.classList.remove("drag-over");
        });
        card.addEventListener("dragover", (event) => {
          event.preventDefault();
          card.classList.add("drag-over");
          event.dataTransfer.dropEffect = "move";
        });
        card.addEventListener("dragleave", () => {
          card.classList.remove("drag-over");
        });
        card.addEventListener("drop", (event) => {
          event.preventDefault();
          card.classList.remove("drag-over");
          const librarySongId = event.dataTransfer.getData("application/x-blindup-library-song");
          if (librarySongId) {
            this.replaceSlotSong(slot.slot_id, Number(librarySongId));
            return;
          }
          const draggedSlotId = Number(event.dataTransfer.getData("application/x-blindup-slot"));
          if (draggedSlotId && draggedSlotId !== slot.slot_id) {
            const rect = card.getBoundingClientRect();
            const placeAfter = event.clientY > rect.top + rect.height / 2;
            this.moveSlot(draggedSlotId, slot.slot_id, placeAfter);
          }
        });
        this.elements.songList.appendChild(card);
      }
    }

    renderLibrary() {
      const query = this.elements.librarySearch.value.trim().toLowerCase();
      this.elements.libraryList.innerHTML = "";
      const songs = this.librarySongs.filter((song) => {
        if (!query) {
          return true;
        }
        return [song.title, song.artist, song.album, song.year]
          .join(" ")
          .toLowerCase()
          .includes(query);
      });

      for (const song of songs) {
        const item = document.createElement("article");
        item.className = "library-item";
        item.draggable = true;
        item.dataset.songId = String(song.id);
        const cover = this.createCoverThumb(song);
        const body = document.createElement("div");
        const details = [normalizeText(song.album), song.year === null || song.year === undefined ? "" : String(song.year)]
          .filter(Boolean)
          .join(" • ");
        body.innerHTML = `
          <div class="library-item-header">
            <div class="library-item-meta">
              <div class="library-item-title">${this.escapeHtml(
                normalizeText(song.title) || `Song ${song.id}`
              )} - ${this.escapeHtml(normalizeText(song.artist) || "Unknown artist")}</div>
              <div class="library-item-subtitle">${this.escapeHtml(details || " ")}</div>
              <div class="library-item-details">${this.escapeHtml(
                formatDuration(song.duration_sec)
              )}</div>
            </div>
          </div>
        `;
        item.appendChild(cover);
        item.appendChild(body);
        item.addEventListener("click", () => {
          if (this.activeSlotId === null) {
            this.appendSlot(song.id);
            return;
          }
          this.replaceSlotSong(this.activeSlotId, song.id);
        });
        item.addEventListener("dragstart", (event) => {
          item.classList.add("is-dragging");
          event.dataTransfer.setData("text/plain", String(song.id));
          event.dataTransfer.setData("application/x-blindup-library-song", String(song.id));
          event.dataTransfer.effectAllowed = "copyMove";
        });
        item.addEventListener("dragend", () => {
          item.classList.remove("is-dragging");
        });
        this.elements.libraryList.appendChild(item);
      }
    }

    renderEditor() {
      const slot = this.getActiveSlot();
      if (slot === null) {
        this.showEditorEmpty();
        return;
      }

      this.elements.songEditorEmpty.hidden = true;
      this.elements.songEditorContent.hidden = false;
      this.fillMetadataForm(slot);
      this.loadSlotWaveform(slot);
    }

    fillMetadataForm(slot) {
      const source = this.librarySongMap.get(slot.song_id) || {};
      this.elements.overrideTitle.value = slot.override_title || "";
      this.elements.overrideArtist.value = slot.override_artist || "";
      this.elements.overrideAlbum.value = slot.override_album || "";
      this.elements.overrideYear.value = slot.override_year === "" ? "" : slot.override_year;
      this.elements.overrideGenre.value = slot.override_genre || "";
      this.elements.overrideCover.value = slot.override_cover || "";
      this.elements.customHint.value = slot.custom_hint || "";
      this.elements.overrideTitle.placeholder = normalizeText(source.title);
      this.elements.overrideArtist.placeholder = normalizeText(source.artist);
      this.elements.overrideAlbum.placeholder = normalizeText(source.album);
      this.elements.overrideYear.placeholder =
        source.year === null || source.year === undefined ? "" : String(source.year);
      this.elements.overrideGenre.placeholder = normalizeText(source.genre);
      this.elements.overrideCover.placeholder = normalizeText(source.cover_path);
    }

    loadSlotWaveform(slot) {
      if (slot.song_id === this.currentLoadedSongId && this.wavesurfer !== null) {
        this.pendingStart = slot.start_sec;
        this.selectionEnd =
          Number.isFinite(slot.start_sec) && Number.isFinite(slot.duration_sec)
            ? slot.start_sec + slot.duration_sec
            : null;
        this.renderCurrentSelection();
        this.updateDisplays();
        this.updateMarkLabel();
        return;
      }

      this.currentLoadedSongId = slot.song_id;
      this.destroyWaveform();
      this.pendingStart = slot.start_sec;
      this.selectionEnd =
        Number.isFinite(slot.start_sec) && Number.isFinite(slot.duration_sec)
          ? slot.start_sec + slot.duration_sec
          : null;
      this.currentZoom = DEFAULT_ZOOM;
      this.hideError();
      this.updateDisplays();
      this.showPlaceholder("Loading audio...");
      this.setWaveformControlsDisabled(true);

      this.wavesurfer = WaveSurfer.create({
        container: this.elements.waveform,
        waveColor: "#999",
        progressColor: "#333",
        height: 120,
      });
      this.regions = this.wavesurfer.registerPlugin(Regions.create());
      this.regions.on("region-updated", (region) => this.syncSelectionFromRegion(region));
      this.regions.on("region-update-end", (region) => this.syncSelectionFromRegion(region));
      this.wavesurfer.on("timeupdate", () => {
        this.updateDisplays();
        this.updateMarkLabel();
      });
      this.wavesurfer.on("ready", () => {
        this.hideError();
        this.setZoom(DEFAULT_ZOOM);
        this.setWaveformControlsDisabled(false);
        this.renderCurrentSelection();
        this.updateDisplays();
        this.updateMarkLabel();
      });
      this.wavesurfer.on("error", () => this.showAudioError());
      this.wavesurfer.load(`/api/audio/${slot.song_id}`);
    }

    destroyWaveform() {
      if (this.wavesurfer !== null) {
        this.wavesurfer.destroy();
      }
      this.wavesurfer = null;
      this.regions = null;
    }

    showEditorEmpty() {
      this.activeSlotId = null;
      this.currentLoadedSongId = null;
      this.elements.songEditorEmpty.hidden = false;
      this.elements.songEditorContent.hidden = true;
      this.destroyWaveform();
      this.pendingStart = null;
      this.selectionEnd = null;
      this.updateDisplays();
      this.updateMarkLabel();
      this.showPlaceholder("Select a song card");
      this.hideError();
    }

    showPlaceholder(message) {
      this.elements.waveform.innerHTML = `<div class="waveform-empty">${this.escapeHtml(
        message
      )}</div>`;
    }

    showAudioError() {
      this.elements.error.hidden = false;
      this.showPlaceholder("Audio unavailable");
      this.setWaveformControlsDisabled(true);
    }

    hideError() {
      this.elements.error.hidden = true;
    }

    setWaveformControlsDisabled(disabled) {
      this.elements.playPause.disabled = disabled;
      this.elements.zoomOut.disabled = disabled;
      this.elements.zoomIn.disabled = disabled;
      this.elements.zoomReset.disabled = disabled;
      this.elements.mark.disabled = disabled;
      this.elements.reset.disabled = disabled;
    }

    setZoom(value) {
      this.currentZoom = Math.max(MIN_ZOOM, value);
      if (this.wavesurfer !== null) {
        this.wavesurfer.zoom(this.currentZoom);
      }
    }

    getActiveSlot() {
      return this.blindtest.songs.find((slot) => slot.slot_id === this.activeSlotId) || null;
    }

    setActiveSlot(slotId) {
      this.activeSlotId = slotId;
      this.renderSongList();
      this.renderEditor();
    }

    appendSlot(songId) {
      const slot = this.createSlot(songId, this.blindtest.songs.length);
      this.blindtest.songs.push(slot);
      this.reindexSongs();
      this.setActiveSlot(slot.slot_id);
    }

    createSlot(songId, orderIndex) {
      return {
        slot_id: this.nextSlotId++,
        song_id: songId,
        order_index: orderIndex,
        start_sec: null,
        duration_sec: null,
        override_title: "",
        override_artist: "",
        override_album: "",
        override_year: "",
        override_genre: "",
        override_cover: "",
        custom_hint: "",
      };
    }

    replaceSlotSong(slotId, songId) {
      const index = this.blindtest.songs.findIndex((slot) => slot.slot_id === slotId);
      if (index === -1) {
        return;
      }
      this.blindtest.songs[index] = {
        ...this.createSlot(songId, this.blindtest.songs[index].order_index),
        slot_id: slotId,
      };
      this.setActiveSlot(slotId);
      this.renderSongList();
      this.renderLibrary();
    }

    removeSlot(slotId) {
      const index = this.blindtest.songs.findIndex((slot) => slot.slot_id === slotId);
      if (index === -1) {
        return;
      }
      this.blindtest.songs.splice(index, 1);
      this.reindexSongs();
      if (this.activeSlotId === slotId) {
        const nextSlot = this.blindtest.songs[index] || this.blindtest.songs[index - 1] || null;
        this.activeSlotId = nextSlot ? nextSlot.slot_id : null;
      }
      this.renderSongList();
      this.renderEditor();
    }

    moveSlot(draggedSlotId, targetSlotId, placeAfter) {
      const sourceIndex = this.blindtest.songs.findIndex((slot) => slot.slot_id === draggedSlotId);
      const targetIndex = this.blindtest.songs.findIndex((slot) => slot.slot_id === targetSlotId);
      if (sourceIndex === -1 || targetIndex === -1) {
        return;
      }
      const [slot] = this.blindtest.songs.splice(sourceIndex, 1);
      let insertIndex = targetIndex;
      if (sourceIndex < targetIndex) {
        insertIndex -= 1;
      }
      if (placeAfter) {
        insertIndex += 1;
      }
      this.blindtest.songs.splice(insertIndex, 0, slot);
      this.reindexSongs();
      this.renderSongList();
    }

    reindexSongs() {
      this.blindtest.songs.forEach((slot, index) => {
        slot.order_index = index;
      });
    }

    handleMetadataInput(event) {
      const slot = this.getActiveSlot();
      if (slot === null) {
        return;
      }

      const field = event.target.name;
      if (!field) {
        return;
      }

      if (field === "override_year") {
        slot.override_year = event.target.value === "" ? "" : numberOrNull(event.target.value) ?? "";
      } else {
        slot[field] = event.target.value;
      }
      this.renderSongList();
    }

    handleMark() {
      if (this.wavesurfer === null) {
        return;
      }

      const duration = this.wavesurfer.getDuration();
      const current = clamp(this.wavesurfer.getCurrentTime(), 0, duration || 0);
      if (this.pendingStart === null) {
        this.pendingStart = current;
        this.selectionEnd = null;
        this.renderPendingRegion();
        return;
      }

      if (this.selectionEnd === null) {
        if (current < this.pendingStart) {
          this.pendingStart = current;
          this.renderPendingRegion();
          return;
        }

        this.selectionEnd = current;
        if (this.selectionEnd <= this.pendingStart) {
          this.selectionEnd = Math.min(duration, this.pendingStart + MIN_REGION_SPAN);
        }
        this.renderSelectionRegion();
        return;
      }

      if (current < this.pendingStart) {
        this.pendingStart = current;
      } else if (current > this.selectionEnd) {
        this.selectionEnd = current;
      } else {
        const relative =
          (current - this.pendingStart) / (this.selectionEnd - this.pendingStart);
        if (relative <= 0.25) {
          this.pendingStart = current;
        } else {
          this.selectionEnd = current;
        }
      }

      this.correctSelection();
      this.renderSelectionRegion();
    }

    correctSelection() {
      if (this.wavesurfer === null || this.pendingStart === null || this.selectionEnd === null) {
        return;
      }

      const duration = this.wavesurfer.getDuration();
      this.pendingStart = Math.max(0, this.pendingStart);
      this.selectionEnd = Math.max(this.pendingStart + MIN_REGION_SPAN, this.selectionEnd);
      if (duration > 0 && this.selectionEnd > duration) {
        this.selectionEnd = duration;
        this.pendingStart = Math.max(0, this.selectionEnd - MIN_REGION_SPAN);
      }
    }

    renderPendingRegion() {
      if (this.wavesurfer === null || this.regions === null || this.pendingStart === null) {
        return;
      }

      const duration = this.wavesurfer.getDuration();
      const end =
        duration > 0
          ? Math.min(duration, this.pendingStart + MIN_REGION_SPAN)
          : this.pendingStart + MIN_REGION_SPAN;
      this.regions.addRegion({
        start: this.pendingStart,
        end,
        drag: true,
        resize: false,
        pending: true,
      });
      this.persistSelection();
      this.updateDisplays();
      this.updateMarkLabel();
    }

    renderSelectionRegion() {
      if (
        this.wavesurfer === null ||
        this.regions === null ||
        this.pendingStart === null ||
        this.selectionEnd === null
      ) {
        return;
      }

      this.correctSelection();
      this.regions.addRegion({
        start: this.pendingStart,
        end: this.selectionEnd,
        drag: true,
        resize: true,
        pending: false,
      });
      this.persistSelection();
      this.updateDisplays();
      this.updateMarkLabel();
    }

    renderCurrentSelection() {
      if (this.regions === null) {
        return;
      }

      this.regions.clearRegions();
      if (this.pendingStart === null) {
        this.persistSelection();
        this.updateDisplays();
        this.updateMarkLabel();
        return;
      }
      if (this.selectionEnd === null) {
        this.renderPendingRegion();
        return;
      }
      this.renderSelectionRegion();
    }

    syncSelectionFromRegion(region) {
      this.pendingStart = region.start;
      this.selectionEnd = region.pending ? null : region.end;
      this.persistSelection();
      this.updateDisplays();
      this.updateMarkLabel();
      this.renderSongList();
    }

    resetSelection() {
      this.pendingStart = null;
      this.selectionEnd = null;
      if (this.regions !== null) {
        this.regions.clearRegions();
      }
      this.persistSelection();
      this.updateDisplays();
      this.updateMarkLabel();
      this.renderSongList();
    }

    persistSelection() {
      const slot = this.getActiveSlot();
      if (slot === null) {
        return;
      }

      slot.start_sec = this.pendingStart;
      slot.duration_sec =
        Number.isFinite(this.pendingStart) && Number.isFinite(this.selectionEnd)
          ? Math.max(0, this.selectionEnd - this.pendingStart)
          : null;
    }

    updateDisplays() {
      const current = this.wavesurfer ? this.wavesurfer.getCurrentTime() : 0;
      this.elements.currentTime.textContent = formatTime(current);
      this.elements.startTime.textContent = formatTime(this.pendingStart);
      this.elements.endTime.textContent = formatTime(this.selectionEnd);
      this.elements.duration.textContent =
        Number.isFinite(this.pendingStart) && Number.isFinite(this.selectionEnd)
          ? formatDuration(this.selectionEnd - this.pendingStart)
          : "--.-s";
    }

    updateMarkLabel() {
      this.elements.mark.textContent = "Mark";
    }

    async saveBlindtest() {
      const response = await fetch("/api/blindtest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: this.blindtest.id,
          title: this.blindtest.title,
          background_image: this.blindtest.background_image,
          game_mode: this.blindtest.game_mode,
          pre_play_delay_sec: this.blindtest.pre_play_delay_sec,
          auto_enabled_default: this.blindtest.auto_enabled_default,
          hints_enabled_default: this.blindtest.hints_enabled_default,
          answer_timer_enabled: this.blindtest.answer_timer_enabled,
          answer_duration_sec: this.blindtest.answer_duration_sec,
          round3_step_durations: this.blindtest.round3_step_durations,
          round3_step_gap_sec: this.blindtest.round3_step_gap_sec,
          round3_progression_mode: this.blindtest.round3_progression_mode,
          songs: this.blindtest.songs.map((slot) => ({
            song_id: slot.song_id,
            order_index: slot.order_index,
            start_sec: slot.start_sec,
            duration_sec: slot.duration_sec,
            override_title: normalizeText(slot.override_title) || null,
            override_artist: normalizeText(slot.override_artist) || null,
            override_album: normalizeText(slot.override_album) || null,
            override_year: slot.override_year === "" ? null : numberOrNull(slot.override_year),
            override_genre: normalizeText(slot.override_genre) || null,
            override_cover: normalizeText(slot.override_cover) || null,
            custom_hint: normalizeText(slot.custom_hint) || null,
          })),
        }),
      });
      const payload = await response.json();
      this.hydrateBlindtest(payload.blindtest);
      this.renderAll();
    }

    showEditorView() {
      this.currentView = "editor";
      this.playerState = null;
      this.playerHistory = [];
      this.stopPlayerPlayback();
      this.elements.pageTitle.textContent = "Blindtest editor";
      this.elements.editorLayout.hidden = false;
      this.playerElements.layout.hidden = true;
    }

    showPlayerView() {
      this.currentView = "player";
      this.elements.pageTitle.textContent = "Blindtest player";
      this.elements.editorLayout.hidden = true;
      this.playerElements.layout.hidden = false;
    }

    launchPlayer() {
      this.playerSongs = this.buildPlayerSongs();
      this.playerOrders = {
        1: this.playerSongs.slice(),
        2: shuffleList(this.playerSongs),
        3: shuffleList(this.playerSongs),
      };
      this.playerHistory = [];
      this.playerHintDefinitions = [];
      this.playerHintRevealCount = 0;
      this.playerState = {
        blindtest_id: this.blindtest.id,
        mode: this.blindtest.game_mode,
        current_round: 1,
        current_song_index: 0,
        panel: "waiting",
        auto_enabled: this.blindtest.auto_enabled_default,
        hints_visible: this.blindtest.hints_enabled_default,
        round3_step_index: 0,
      };
      this.showPlayerView();
      this.enterCurrentPlayerPanel();
    }

    buildPlayerSongs() {
      return this.blindtest.songs.map((slot) => {
        const source = this.librarySongMap.get(slot.song_id) || {};
        return {
          ...slot,
          source,
        };
      });
    }

    handlePlayerKeydown(event) {
      if (this.currentView !== "player" || this.playerState === null) {
        return;
      }
      if (event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }

      const key = event.key;
      if (key === " " || key === "ArrowRight" || key === "ArrowDown") {
        event.preventDefault();
        this.handlePlayerNext();
        return;
      }
      if (key === "ArrowLeft" || key === "ArrowUp" || key === "Backspace") {
        event.preventDefault();
        this.handlePlayerPrevious();
        return;
      }
      if (key === "Escape" || key.toLowerCase() === "i") {
        event.preventDefault();
        this.togglePlayerHints();
        return;
      }
      if (key.toLowerCase() === "a") {
        event.preventDefault();
        this.togglePlayerAuto();
        return;
      }
      if (key.toLowerCase() === "d") {
        event.preventDefault();
        this.advanceRound3Step();
      }
    }

    togglePlayerAuto() {
      if (this.playerState === null) {
        return;
      }
      this.playerState.auto_enabled = !this.playerState.auto_enabled;
      this.updatePlayerControls();
    }

    togglePlayerHints() {
      if (this.playerState === null) {
        return;
      }
      this.playerState.hints_visible = !this.playerState.hints_visible;
      this.updatePlayerControls();
      this.renderPlayerHints();
    }

    handlePlayerPrevious() {
      if (this.playerHistory.length === 0) {
        return;
      }
      this.playerState = this.playerHistory.pop();
      this.enterCurrentPlayerPanel();
    }

    handlePlayerNext() {
      if (this.playerState === null) {
        return;
      }

      if (this.playerState.panel === "waiting") {
        this.pushPlayerHistory();
        if (this.getSongsForRound(1).length === 0) {
          this.playerState.panel = "end";
        } else {
          this.playerState.panel = "teaser";
        }
        this.playerState.current_round = 1;
        this.playerState.current_song_index = 0;
        this.playerState.round3_step_index = 0;
        this.enterCurrentPlayerPanel();
        return;
      }

      if (this.playerState.panel === "round_transition") {
        this.pushPlayerHistory();
        this.playerState.panel = "teaser";
        this.playerState.current_song_index = 0;
        this.playerState.round3_step_index = 0;
        this.enterCurrentPlayerPanel();
        return;
      }

      if (this.playerState.panel === "teaser") {
        this.pushPlayerHistory();
        this.playerState.panel = "answer";
        this.enterCurrentPlayerPanel();
        return;
      }

      if (this.playerState.panel === "answer") {
        this.pushPlayerHistory();
        this.advanceAfterAnswer();
      }
    }

    pushPlayerHistory() {
      if (this.playerState === null) {
        return;
      }
      this.playerHistory.push(JSON.parse(JSON.stringify(this.playerState)));
    }

    advanceAfterAnswer() {
      if (this.playerState === null) {
        return;
      }

      const roundSongs = this.getSongsForRound(this.playerState.current_round);
      if (this.playerState.current_song_index + 1 < roundSongs.length) {
        this.playerState.current_song_index += 1;
        this.playerState.panel = "teaser";
        this.playerState.round3_step_index = 0;
        this.enterCurrentPlayerPanel();
        return;
      }

      if (this.playerState.mode === "blindup" && this.playerState.current_round < 3) {
        this.playerState.current_round += 1;
        this.playerState.current_song_index = 0;
        this.playerState.round3_step_index = 0;
        this.playerState.panel = "round_transition";
        this.enterCurrentPlayerPanel();
        return;
      }

      this.playerState.panel = "end";
      this.enterCurrentPlayerPanel();
    }

    advanceRound3Step() {
      if (
        this.playerState === null ||
        this.playerState.panel !== "teaser" ||
        this.playerState.current_round !== 3
      ) {
        return;
      }

      const steps = this.getRound3Steps();
      if (this.playerState.round3_step_index >= steps.length - 1) {
        return;
      }

      this.playerState.round3_step_index += 1;
      this.enterCurrentPlayerPanel();
    }

    enterCurrentPlayerPanel() {
      this.stopPlayerPlayback();
      this.playerPanelToken += 1;
      this.playerHintDefinitions = [];
      this.playerHintRevealCount = 0;
      this.clearPlayerError();
      this.renderPlayerBase();
      this.updatePlayerControls();

      if (this.playerState === null) {
        return;
      }

      const song = this.getCurrentPlayerSong();
      if (this.playerState.panel === "waiting") {
        this.setPlayerBackground(this.blindtest.background_image);
        this.playerElements.panelLabel.textContent = "Waiting";
        this.playerElements.mainTitle.textContent = this.blindtest.title || "BLINDUP";
        this.playerElements.subtitle.textContent = "";
        return;
      }

      if (this.playerState.panel === "round_transition") {
        this.setPlayerBackground(this.blindtest.background_image);
        this.playerElements.panelLabel.textContent = "Round transition";
        this.playerElements.mainTitle.textContent =
          ROUND_TRANSITION_TITLES[this.playerState.current_round] || "Round";
        this.playerElements.subtitle.textContent = "";
        return;
      }

      if (this.playerState.panel === "teaser") {
        this.setPlayerBackground(song ? this.getSongCover(song) : this.blindtest.background_image);
        this.playerElements.panelLabel.textContent = "Teaser";
        this.playerElements.mainTitle.textContent = "BLINDUP";
        this.playerElements.subtitle.textContent =
          this.playerState.current_round === 3
            ? `Step ${this.playerState.round3_step_index + 1} / ${this.getRound3Steps().length}`
            : "";
        if (song !== null) {
          this.startTeaserPanel(this.playerPanelToken, song);
        }
        return;
      }

      if (this.playerState.panel === "answer") {
        this.setPlayerBackground(song ? this.getSongCover(song) : this.blindtest.background_image);
        this.playerElements.panelLabel.textContent = "Answer";
        if (song !== null) {
          this.fillPlayerAnswer(song);
          this.startAnswerPanel(this.playerPanelToken, song);
        }
        return;
      }

      this.setPlayerBackground(this.blindtest.background_image);
      this.playerElements.panelLabel.textContent = "End";
      this.playerElements.mainTitle.textContent = "BLINDUP";
      this.playerElements.subtitle.textContent = "";
    }

    renderPlayerBase() {
      this.playerElements.answer.hidden = true;
      this.playerElements.hints.hidden = true;
      this.playerElements.hints.innerHTML = "";
      this.playerElements.countdown.hidden = true;
      this.playerElements.countdown.textContent = "";
      this.playerElements.subtitle.hidden = false;
      this.playerElements.error.hidden = true;
      this.playerElements.roundLabel.textContent = "Blindtest player";
      this.playerElements.position.textContent = this.getPlayerPositionText();
    }

    updatePlayerControls() {
      const autoEnabled = this.playerState !== null && this.playerState.auto_enabled;
      const hintsVisible = this.playerState !== null && this.playerState.hints_visible;
      this.playerElements.autoButton.textContent = `Auto: ${autoEnabled ? "on" : "off"}`;
      this.playerElements.hintsButton.textContent = `Hints: ${hintsVisible ? "shown" : "hidden"}`;
      this.playerElements.prevButton.disabled = this.playerHistory.length === 0;
      const showStep =
        this.playerState !== null &&
        this.playerState.panel === "teaser" &&
        this.playerState.current_round === 3;
      this.playerElements.stepButton.hidden = !showStep;
      this.playerElements.stepButton.disabled =
        !showStep ||
        this.playerState.round3_step_index >= this.getRound3Steps().length - 1;
    }

    getPlayerPositionText() {
      if (this.playerState === null) {
        return "";
      }

      if (this.playerState.panel === "waiting" || this.playerState.panel === "end") {
        return "";
      }

      const roundSongs = this.getSongsForRound(this.playerState.current_round);
      const totalSongs = roundSongs.length;
      const songIndex = Math.min(this.playerState.current_song_index + 1, totalSongs);
      return `Round ${this.playerState.current_round} • Song ${songIndex} / ${totalSongs}`;
    }

    getSongsForRound(roundNumber) {
      if (roundNumber === 1) {
        return this.playerOrders[1];
      }
      if (this.playerState !== null && this.playerState.mode !== "blindup") {
        return [];
      }
      return this.playerOrders[roundNumber] || [];
    }

    getCurrentPlayerSong() {
      if (this.playerState === null) {
        return null;
      }

      return this.getSongsForRound(this.playerState.current_round)[
        this.playerState.current_song_index
      ] || null;
    }

    getSongDisplay(song) {
      return {
        title:
          normalizeText(song.override_title) ||
          normalizeText(song.source.title) ||
          `Song ${song.song_id}`,
        artist:
          normalizeText(song.override_artist) ||
          normalizeText(song.source.artist) ||
          "",
        album:
          normalizeText(song.override_album) ||
          normalizeText(song.source.album) ||
          "",
        year:
          song.override_year !== "" && song.override_year !== null && song.override_year !== undefined
            ? String(song.override_year)
            : song.source.year === null || song.source.year === undefined
              ? ""
              : String(song.source.year),
        genre:
          normalizeText(song.override_genre) ||
          normalizeText(song.source.genre) ||
          "",
      };
    }

    getSongCover(song) {
      return normalizeText(song.override_cover) || normalizeText(song.source.cover_path) || "";
    }

    setPlayerBackground(imagePath) {
      const background = this.playerElements.background;
      const normalizedPath = normalizeText(imagePath);
      if (normalizedPath) {
        background.style.backgroundImage = `url("${normalizedPath}"), radial-gradient(circle at top, rgba(247, 224, 186, 0.8), transparent 35%), linear-gradient(180deg, rgba(36, 28, 19, 0.9), rgba(70, 45, 26, 0.82))`;
        background.classList.add("has-image");
        return;
      }
      background.style.backgroundImage = "";
      background.classList.remove("has-image");
    }

    getRound3Steps() {
      const parsed = `${this.blindtest.round3_step_durations || ""}`
        .split(",")
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isFinite(value) && value > 0);
      return parsed.length > 0 ? parsed : [0.5];
    }

    getTeaserPlayback(song) {
      const start = Number.isFinite(song.start_sec) ? song.start_sec : 0;
      const duration = Number.isFinite(song.duration_sec) ? song.duration_sec : 0;
      if (this.playerState.current_round === 1) {
        return { start, duration, reverse: false };
      }
      if (this.playerState.current_round === 2) {
        return { start, duration, reverse: true };
      }

      const steps = this.getRound3Steps();
      const index = clamp(this.playerState.round3_step_index, 0, steps.length - 1);
      const stepDuration = steps[index];
      if (this.blindtest.round3_progression_mode === "continuous") {
        const offset = steps.slice(0, index).reduce((sum, value) => sum + value, 0);
        return {
          start: start + offset,
          duration: stepDuration,
          reverse: false,
        };
      }

      return { start, duration: stepDuration, reverse: false };
    }

    getPrePlayDelay() {
      if (
        this.playerState !== null &&
        this.playerState.current_round === 3 &&
        this.playerState.round3_step_index > 0
      ) {
        return Math.max(0, this.blindtest.round3_step_gap_sec || 0);
      }
      return Math.max(0, this.blindtest.pre_play_delay_sec || 0);
    }

    startTeaserPanel(token, song) {
      const playback = this.getTeaserPlayback(song);
      this.playerHintDefinitions = this.buildPlayerHints(song);
      this.playerHintRevealCount = 0;
      this.renderPlayerHints();
      const delay = this.getPrePlayDelay();

      if (delay > 0) {
        this.startCountdown(delay, token);
      }

      this.playerPrePlayTimeout = window.setTimeout(() => {
        if (token !== this.playerPanelToken) {
          return;
        }
        this.startCountdown(playback.duration, token);
        this.startHintTracking(playback.duration, token);
        if (playback.duration <= 0) {
          this.handleTeaserPlaybackComplete(token);
          return;
        }
        if (playback.reverse) {
          this.playReverseSegment(song.song_id, playback.start, playback.duration, token, () => {
            this.handleTeaserPlaybackComplete(token);
          });
          return;
        }
        this.playNormalAudio(
          song.song_id,
          playback.start,
          playback.start + playback.duration,
          token,
          () => {
            this.handleTeaserPlaybackComplete(token);
          }
        );
      }, delay * 1000);
    }

    handleTeaserPlaybackComplete(token) {
      if (token !== this.playerPanelToken || this.playerState === null) {
        return;
      }

      if (!this.playerState.auto_enabled) {
        return;
      }

      if (
        this.playerState.current_round === 3 &&
        this.playerState.round3_step_index < this.getRound3Steps().length - 1
      ) {
        return;
      }

      this.pushPlayerHistory();
      this.playerState.panel = "answer";
      this.enterCurrentPlayerPanel();
    }

    buildPlayerHints(song) {
      if (this.playerState === null) {
        return [];
      }

      const display = this.getSongDisplay(song);
      const cover = this.getSongCover(song);
      if (this.playerState.current_round === 3) {
        return [];
      }

      if (this.playerState.current_round === 2) {
        return normalizeText(song.custom_hint)
          ? [{ label: "Hint", type: "text", value: normalizeText(song.custom_hint) }]
          : [];
      }

      const hints = [];
      if (normalizeText(song.custom_hint)) {
        hints.push({ label: "Hint", type: "text", value: normalizeText(song.custom_hint) });
      }
      if (display.year) {
        hints.push({ label: "Year", type: "text", value: display.year });
      }
      if (display.genre) {
        hints.push({ label: "Genre", type: "text", value: display.genre });
      }
      if (display.album) {
        hints.push({ label: "Album", type: "text", value: display.album });
      }
      if (cover) {
        hints.push({ label: "Cover", type: "cover", value: cover });
      }
      if (display.artist) {
        hints.push({ label: "Artist", type: "text", value: display.artist });
      }
      return hints;
    }

    renderPlayerHints() {
      if (
        this.playerState === null ||
        !this.playerState.hints_visible ||
        this.playerHintRevealCount === 0
      ) {
        this.playerElements.hints.hidden = true;
        this.playerElements.hints.innerHTML = "";
        return;
      }

      const hints = this.playerHintDefinitions.slice(0, this.playerHintRevealCount);
      if (hints.length === 0) {
        this.playerElements.hints.hidden = true;
        this.playerElements.hints.innerHTML = "";
        return;
      }

      this.playerElements.hints.hidden = false;
      this.playerElements.hints.innerHTML = "";
      for (const hint of hints) {
        const hintNode = document.createElement("div");
        hintNode.className = "player-hint";
        const label = document.createElement("span");
        label.className = "player-hint-label";
        label.textContent = hint.label;
        hintNode.appendChild(label);
        if (hint.type === "cover") {
          const image = document.createElement("img");
          image.alt = hint.label;
          image.src = hint.value;
          hintNode.appendChild(image);
        } else {
          const value = document.createElement("div");
          value.textContent = hint.value;
          hintNode.appendChild(value);
        }
        this.playerElements.hints.appendChild(hintNode);
      }
    }

    startHintTracking(durationSec, token) {
      const startedAt = Date.now();
      if (this.playerHintInterval !== null) {
        window.clearInterval(this.playerHintInterval);
      }
      this.playerHintInterval = window.setInterval(() => {
        if (token !== this.playerPanelToken) {
          return;
        }
        const elapsedSec = Math.min(durationSec, (Date.now() - startedAt) / 1000);
        const revealCount = Math.min(
          this.playerHintDefinitions.length,
          Math.floor(elapsedSec / 5)
        );
        if (revealCount !== this.playerHintRevealCount) {
          this.playerHintRevealCount = revealCount;
          this.renderPlayerHints();
        }
      }, 150);
    }

    fillPlayerAnswer(song) {
      const display = this.getSongDisplay(song);
      this.playerElements.answer.hidden = false;
      this.playerElements.mainTitle.textContent = display.title;
      this.playerElements.subtitle.textContent = display.artist;
      this.playerElements.answerTitle.textContent = display.title;
      this.playerElements.answerArtist.textContent = display.artist || " ";
      this.playerElements.answerAlbum.textContent = display.album || " ";
      this.playerElements.answerYear.textContent = display.year || " ";
      this.playerElements.answerGenre.textContent = display.genre || " ";
      this.playerElements.cover.innerHTML = "";
      const coverPath = this.getSongCover(song);
      if (coverPath) {
        const image = document.createElement("img");
        image.src = coverPath;
        image.alt = display.title;
        this.playerElements.cover.appendChild(image);
        return;
      }
      this.playerElements.cover.appendChild(
        this.createCoverThumb({ title: display.title || "Song" })
      );
    }

    startAnswerPanel(token, song) {
      if (this.playerState === null) {
        return;
      }

      if (this.playerState.current_round === 1) {
        this.playNormalAudio(song.song_id, 0, null, token, () => {});
      } else if (this.playerState.current_round === 2) {
        const playback = this.getTeaserPlayback(song);
        this.playNormalAudio(
          song.song_id,
          playback.start,
          playback.start + playback.duration,
          token,
          () => {}
        );
      }

      const answerDuration = Math.max(0, this.blindtest.answer_duration_sec || 0);
      if (this.blindtest.answer_timer_enabled) {
        this.startCountdown(answerDuration, token);
      }

      if (this.playerState.auto_enabled) {
        this.playerAutoTimeout = window.setTimeout(() => {
          if (token !== this.playerPanelToken) {
            return;
          }
          this.pushPlayerHistory();
          this.advanceAfterAnswer();
        }, answerDuration * 1000);
      }
    }

    startCountdown(durationSec, token) {
      this.playerElements.countdown.hidden = false;
      const startedAt = Date.now();
      const updateCountdown = () => {
        if (token !== this.playerPanelToken) {
          return;
        }
        const elapsed = (Date.now() - startedAt) / 1000;
        const remaining = Math.max(0, durationSec - elapsed);
        this.playerElements.countdown.textContent = formatCountdown(remaining);
      };
      updateCountdown();
      const intervalId = window.setInterval(() => {
        updateCountdown();
        if (Date.now() - startedAt >= durationSec * 1000) {
          window.clearInterval(intervalId);
          if (this.playerCountdownInterval === intervalId) {
            this.playerCountdownInterval = null;
          }
        }
      }, 100);

      if (this.playerCountdownInterval !== null) {
        window.clearInterval(this.playerCountdownInterval);
      }
      this.playerCountdownInterval = intervalId;
    }

    clearCountdown() {
      if (this.playerCountdownInterval !== null) {
        window.clearInterval(this.playerCountdownInterval);
        this.playerCountdownInterval = null;
      }
      this.playerElements.countdown.hidden = true;
      this.playerElements.countdown.textContent = "";
    }

    clearPlayerError() {
      this.playerElements.error.hidden = true;
    }

    showPlayerError() {
      this.playerElements.error.hidden = false;
      this.playerElements.error.textContent = "Schrouunntch";
    }

    stopPlayerPlayback() {
      if (this.playerPrePlayTimeout !== null) {
        window.clearTimeout(this.playerPrePlayTimeout);
        this.playerPrePlayTimeout = null;
      }
      if (this.playerAutoTimeout !== null) {
        window.clearTimeout(this.playerAutoTimeout);
        this.playerAutoTimeout = null;
      }
      this.clearCountdown();
      if (this.playerHintInterval !== null) {
        window.clearInterval(this.playerHintInterval);
        this.playerHintInterval = null;
      }
      if (this.playerAudioCleanup !== null) {
        this.playerAudioCleanup();
        this.playerAudioCleanup = null;
      }
      this.playerAudio.pause();
      if (this.playerReverseSource !== null) {
        try {
          this.playerReverseSource.stop();
        } catch (error) {
          void error;
        } finally {
          this.playerReverseSource.disconnect();
          this.playerReverseSource = null;
        }
      }
    }

    playNormalAudio(songId, startSec, endSec, token, onComplete) {
      if (this.playerAudioCleanup !== null) {
        this.playerAudioCleanup();
        this.playerAudioCleanup = null;
      }

      const audio = this.playerAudio;
      let finished = false;
      let resolvedEnd = endSec;
      const finish = () => {
        if (finished) {
          return;
        }
        finished = true;
        cleanup();
        if (token === this.playerPanelToken) {
          onComplete();
        }
      };
      const handleError = () => {
        cleanup();
        if (token === this.playerPanelToken) {
          this.showPlayerError();
        }
      };
      const handleLoadedMetadata = () => {
        if (token !== this.playerPanelToken) {
          cleanup();
          return;
        }
        const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
        const safeStart = clamp(startSec || 0, 0, duration || 0);
        resolvedEnd =
          Number.isFinite(endSec) && duration > 0 ? clamp(endSec, safeStart, duration) : endSec;
        audio.currentTime = safeStart;
        audio.play().catch(handleError);
        if (Number.isFinite(resolvedEnd) && resolvedEnd <= safeStart + 0.01) {
          audio.pause();
          finish();
        }
      };
      const handleTimeUpdate = () => {
        if (Number.isFinite(resolvedEnd) && audio.currentTime >= resolvedEnd - 0.05) {
          audio.pause();
          finish();
        }
      };
      const cleanup = () => {
        audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
        audio.removeEventListener("timeupdate", handleTimeUpdate);
        audio.removeEventListener("ended", finish);
        audio.removeEventListener("error", handleError);
      };

      this.playerAudioCleanup = cleanup;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      audio.addEventListener("loadedmetadata", handleLoadedMetadata);
      audio.addEventListener("timeupdate", handleTimeUpdate);
      audio.addEventListener("ended", finish);
      audio.addEventListener("error", handleError);
      audio.src = `/api/audio/${songId}`;
      audio.load();
    }

    async getPlayerAudioContext() {
      if (this.playerAudioContext === null) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) {
          throw new Error("AudioContext unavailable");
        }
        this.playerAudioContext = new AudioContextClass();
      }
      if (this.playerAudioContext.state === "suspended") {
        await this.playerAudioContext.resume();
      }
      return this.playerAudioContext;
    }

    async playReverseSegment(songId, startSec, durationSec, token, onComplete) {
      try {
        const response = await fetch(`/api/audio/${songId}`);
        if (!response.ok) {
          throw new Error("Audio unavailable");
        }
        const audioContext = await this.getPlayerAudioContext();
        const arrayBuffer = await response.arrayBuffer();
        const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0));
        if (token !== this.playerPanelToken) {
          return;
        }

        const sampleRate = decoded.sampleRate;
        const startFrame = Math.max(0, Math.floor(startSec * sampleRate));
        const endFrame = Math.min(
          decoded.length,
          Math.max(startFrame + 1, Math.floor((startSec + durationSec) * sampleRate))
        );
        const frameCount = Math.max(1, endFrame - startFrame);
        const buffer = audioContext.createBuffer(decoded.numberOfChannels, frameCount, sampleRate);
        for (let channelIndex = 0; channelIndex < decoded.numberOfChannels; channelIndex += 1) {
          const sourceData = decoded.getChannelData(channelIndex);
          const targetData = buffer.getChannelData(channelIndex);
          for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
            targetData[frameIndex] = sourceData[endFrame - 1 - frameIndex];
          }
        }

        const source = audioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(audioContext.destination);
        source.onended = () => {
          if (this.playerReverseSource === source) {
            this.playerReverseSource = null;
          }
          if (token === this.playerPanelToken) {
            onComplete();
          }
        };
        this.playerReverseSource = source;
        source.start();
      } catch (error) {
        if (token === this.playerPanelToken) {
          this.showPlayerError();
        }
      }
    }

    createCoverThumb(song) {
      const cover = document.createElement("div");
      cover.className = "cover-thumb";
      const text = normalizeText(song && song.title) || "Song";
      cover.textContent = text.slice(0, 1).toUpperCase();
      return cover;
    }

    escapeHtml(value) {
      return `${value || ""}`
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
    }
  }

  document.addEventListener("DOMContentLoaded", async () => {
    const app = new BlindUpApp();
    try {
      await app.init();
    } catch (error) {
      app.showAudioError();
    }
    window.blindUpReady = true;
  });
})();
