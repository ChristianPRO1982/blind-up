(function () {
  const DEFAULT_ZOOM = 40;
  const ZOOM_STEP = 1.25;
  const MIN_ZOOM = 10;
  const MAX_ZOOM = 1200;
  const MIN_REGION_SPAN = 0.1;
  const ROUND_TRANSITION_TITLES = {
    2: "Round 2 — Reverse",
    3: "Round 3 — Escalation",
  };
  const PLAYER_DRAFT_STORAGE_KEY = "blindup-player-draft";
  const PLAYER_RETURN_URL_STORAGE_KEY = "blindup-player-return-url";
  const RESTORE_EDITOR_DRAFT_STORAGE_KEY = "blindup-restore-editor-draft";

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

  function appendMultilineText(container, value) {
    const lines = `${value || ""}`.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (index > 0) {
        container.appendChild(document.createElement("br"));
      }
      container.appendChild(document.createTextNode(line));
    });
  }

  function blindtestUpdatedAtValue(blindtest) {
    const parsed = Date.parse(normalizeText(blindtest && blindtest.updated_at));
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  function readSessionJson(key) {
    try {
      const rawValue = window.sessionStorage.getItem(key);
      return rawValue ? JSON.parse(rawValue) : null;
    } catch (error) {
      return null;
    }
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
        this.emitter.emit("interaction");
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

  const WaveSurferFallback = createWaveSurferFallback();
  const RegionsFallback = createRegionsFallback();

  class BlindUpApp {
    constructor() {
      this.elements = {
        pageTitle: document.getElementById("page-title"),
        homeLayout: document.getElementById("home-layout"),
        homeBlindtestList: document.getElementById("home-blindtest-list"),
        openScanButton: document.getElementById("open-scan-button"),
        newBlindtestButton: document.getElementById("new-blindtest-button"),
        scanLayout: document.getElementById("scan-layout"),
        scanRootPath: document.getElementById("scan-root-path"),
        scanToggleButton: document.getElementById("scan-toggle-button"),
        scanBackButton: document.getElementById("scan-back-button"),
        scanStatus: document.getElementById("scan-status"),
        scanError: document.getElementById("scan-error"),
        scanAddedCount: document.getElementById("scan-added-count"),
        scanRemovedCount: document.getElementById("scan-removed-count"),
        scanImpactEmpty: document.getElementById("scan-impact-empty"),
        scanImpactList: document.getElementById("scan-impact-list"),
        title: document.getElementById("blindtest-title"),
        toggleLibraryButton: document.getElementById("toggle-library-button"),
        saveButton: document.getElementById("save-button"),
        launchButton: document.getElementById("launch-button"),
        backButton: document.getElementById("back-button"),
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
        addSongButton: document.getElementById("add-song-button"),
        songList: document.getElementById("song-list"),
        songEditorContent: document.getElementById("song-editor-content"),
        metadataForm: document.getElementById("song-metadata-form"),
        overrideTitle: document.getElementById("override-title"),
        overrideArtist: document.getElementById("override-artist"),
        overrideAlbum: document.getElementById("override-album"),
        overrideYear: document.getElementById("override-year"),
        overrideGenre: document.getElementById("override-genre"),
        overrideBackground: document.getElementById("override-background"),
        clearBackgroundButton: document.getElementById("clear-background-button"),
        previewBackgroundButton: document.getElementById("preview-background-button"),
        toggleBackgroundPanelButton: document.getElementById("toggle-background-panel-button"),
        customHint: document.getElementById("custom-hint"),
        coverDisplayStatus: document.getElementById("cover-display-status"),
        coverDisplayImage: document.getElementById("cover-display-image"),
        libraryPanel: document.querySelector(".library-panel"),
        closeLibraryButton: document.getElementById("close-library-button"),
        librarySearch: document.getElementById("library-search"),
        libraryList: document.getElementById("library-list"),
        backgroundsPanel: document.querySelector(".backgrounds-panel"),
        closeBackgroundPanelButton: document.getElementById("close-background-panel-button"),
        backgroundGallery: document.getElementById("background-gallery"),
        removeSongModal: document.getElementById("remove-song-modal"),
        closeRemoveSongModalButton: document.getElementById(
          "close-remove-song-modal-button"
        ),
        removeSongModalCopy: document.getElementById("remove-song-modal-copy"),
        cancelRemoveSongButton: document.getElementById("cancel-remove-song-button"),
        confirmRemoveSongButton: document.getElementById("confirm-remove-song-button"),
        backgroundPreviewModal: document.getElementById("background-preview-modal"),
        closeBackgroundPreviewModalButton: document.getElementById(
          "close-background-preview-modal-button"
        ),
        backgroundPreviewImage: document.getElementById("background-preview-image"),
        error: document.getElementById("audio-error"),
        waveform: document.getElementById("waveform"),
        waveWrap: document.getElementById("waveWrap"),
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
        playPauseButton: document.getElementById("player-play-pause-button"),
        nextButton: document.getElementById("player-next-button"),
        stepButton: document.getElementById("player-step-button"),
        background: document.getElementById("player-background"),
        roundLabel: document.getElementById("player-round-label"),
        position: document.getElementById("player-position"),
        panelLabel: document.getElementById("player-panel-label"),
        mainTitle: document.getElementById("player-main-title"),
        stageMetaHost: document.getElementById("player-stage-meta-host"),
        countdown: document.getElementById("player-countdown"),
        error: document.getElementById("player-error"),
        hints: document.getElementById("player-hints"),
        answerHost: document.getElementById("player-answer-host"),
        exitModal: document.getElementById("player-exit-modal"),
        closeExitModalButton: document.getElementById("close-player-exit-modal-button"),
        cancelExitButton: document.getElementById("cancel-player-exit-button"),
        confirmExitButton: document.getElementById("confirm-player-exit-button"),
      };
      this.page = document.body.dataset.page || "home";
      this.pageBlindtestId = numberOrNull(document.body.dataset.blindtestId);
      this.editorMode = document.body.dataset.editorMode || "";
      this.currentView = this.page;
      this.homeBlindtests = [];
      this.scanState = { status: "idle", summary: null, error: null };
      this.scanPollInterval = null;
      this.latestScanSummaryKey = "";
      this.librarySongs = [];
      this.librarySongMap = new Map();
      this.backgroundGallery = this.readBackgroundGallery();
      this.activeSidebarPanel = null;
      this.pendingRemoveSlotId = null;
      this.blindtest = this.createDefaultBlindtest();
      this.activeSlotId = null;
      this.nextSlotId = 1;
      this.currentZoom = DEFAULT_ZOOM;
      this.pendingStart = null;
      this.selectionEnd = null;
      this.currentLoadedSongId = null;
      this.wavesurfer = null;
      this.regions = null;
      this.waveSurferLib = window.WaveSurfer || WaveSurferFallback;
      this.regionsLib = window.Regions || RegionsFallback;
      this.waveLibraryPromise = null;
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
      this.playerExitReturnFocus = null;
      this.playerAnswerElements = null;
      this.playerTeaserSession = null;
      window.addEventListener("resize", () => {
        if (this.page === "editor" && this.wavesurfer !== null) {
          this.resetZoom();
        }
      });
      document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") {
          return;
        }
        if (this.pendingRemoveSlotId !== null) {
          this.hideRemoveSongModal();
        }
        if (
          this.elements.backgroundPreviewModal !== null &&
          !this.elements.backgroundPreviewModal.hidden
        ) {
          this.hideBackgroundPreviewModal();
        }
      });
      this.bindHome();
      this.bindForm();
      this.bindPlayerControls();
      if (this.page === "editor") {
        this.showEditorEmpty();
        this.setWaveformControlsDisabled(true);
        this.setSidebarPanel(null);
      }
    }

    readBackgroundGallery() {
      const dataNode = document.getElementById("background-gallery-data");
      if (dataNode === null) {
        return [];
      }
      try {
        const payload = JSON.parse(dataNode.textContent || "[]");
        return Array.isArray(payload) ? payload : [];
      } catch (error) {
        console.error("Invalid background gallery payload", error);
        return [];
      }
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

    async ensureWaveLibraries() {
      if (
        this.waveSurferLib !== WaveSurferFallback &&
        this.regionsLib !== RegionsFallback
      ) {
        return;
      }

      if (this.waveLibraryPromise === null) {
        this.waveLibraryPromise = Promise.all([
          import("https://unpkg.com/wavesurfer.js@7/dist/wavesurfer.esm.js").catch(
            () => null
          ),
          import(
            "https://unpkg.com/wavesurfer.js@7/dist/plugins/regions.esm.js"
          ).catch(() => null),
        ]).then(([waveModule, regionsModule]) => {
          if (waveModule && waveModule.default) {
            this.waveSurferLib = waveModule.default;
          }
          if (regionsModule && regionsModule.default) {
            this.regionsLib = regionsModule.default;
          }
        });
      }

      await this.waveLibraryPromise;
    }

    bindHome() {
      if (this.elements.openScanButton !== null) {
        this.elements.openScanButton.addEventListener("click", () => {
          this.showScanView();
        });
      }
      if (this.elements.newBlindtestButton !== null) {
        this.elements.newBlindtestButton.addEventListener("click", () => {
          this.startNewBlindtest();
        });
      }
      if (this.elements.scanToggleButton !== null) {
        this.elements.scanToggleButton.addEventListener("click", () => {
          this.handleScanToggle().catch(() => {});
        });
      }
      if (this.elements.scanBackButton !== null) {
        this.elements.scanBackButton.addEventListener("click", () => {
          this.stopScanPolling();
          this.showHomeView();
        });
      }
    }

    bindForm() {
      if (this.elements.title === null) {
        return;
      }

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
      this.elements.toggleLibraryButton.addEventListener("click", () => {
        this.toggleSidebarPanel("library");
      });
      this.elements.launchButton.addEventListener("click", () => {
        this.launchPlayer();
      });
      this.elements.backButton.addEventListener("click", () => {
        this.showHomeView();
      });
      this.elements.addSongButton.addEventListener("click", () => {
        this.appendPendingSlot();
      });
      this.elements.closeLibraryButton.addEventListener("click", () => {
        this.setSidebarPanel(null);
      });
      this.elements.previewBackgroundButton.addEventListener("click", () => {
        this.showBackgroundPreviewModal();
      });
      this.elements.clearBackgroundButton.addEventListener("click", () => {
        this.clearBackgroundSelection();
      });
      this.elements.toggleBackgroundPanelButton.addEventListener("click", () => {
        this.toggleSidebarPanel("backgrounds");
      });
      this.elements.closeBackgroundPanelButton.addEventListener("click", () => {
        this.setSidebarPanel(null);
      });
      this.elements.removeSongModal.addEventListener("click", (event) => {
        const action = event.target.closest("[data-action='close']");
        if (action !== null || event.target === this.elements.removeSongModal) {
          this.hideRemoveSongModal();
        }
      });
      this.elements.closeRemoveSongModalButton.addEventListener("click", () => {
        this.hideRemoveSongModal();
      });
      this.elements.cancelRemoveSongButton.addEventListener("click", () => {
        this.hideRemoveSongModal();
      });
      this.elements.confirmRemoveSongButton.addEventListener("click", () => {
        this.confirmRemoveSlot();
      });
      this.elements.backgroundPreviewModal.addEventListener("click", (event) => {
        const action = event.target.closest("[data-action='close']");
        if (
          action !== null ||
          event.target === this.elements.backgroundPreviewModal ||
          event.target === this.elements.backgroundPreviewImage
        ) {
          this.hideBackgroundPreviewModal();
        }
      });
      this.elements.closeBackgroundPreviewModalButton.addEventListener("click", () => {
        this.hideBackgroundPreviewModal();
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
      this.elements.zoomOut.addEventListener("click", () => this.setZoom(this.currentZoom / ZOOM_STEP));
      this.elements.zoomIn.addEventListener("click", () => this.setZoom(this.currentZoom * ZOOM_STEP));
      this.elements.zoomReset.addEventListener("click", () => this.resetZoom());
      this.elements.mark.addEventListener("click", () => this.handleMark());
      this.elements.reset.addEventListener("click", () => this.resetSelection());
    }

    bindPlayerControls() {
      if (this.playerElements.backButton !== null) {
        this.playerElements.backButton.addEventListener("click", () => this.openPlayerExitModal());
      }
      if (this.playerElements.autoButton !== null) {
        this.playerElements.autoButton.addEventListener("click", () => this.togglePlayerAuto());
      }
      if (this.playerElements.hintsButton !== null) {
        this.playerElements.hintsButton.addEventListener("click", () => this.togglePlayerHints());
      }
      if (this.playerElements.prevButton !== null) {
        this.playerElements.prevButton.addEventListener("click", () => this.handlePlayerPrevious());
      }
      if (this.playerElements.playPauseButton !== null) {
        this.playerElements.playPauseButton.addEventListener("click", () =>
          this.togglePlayerPlayback()
        );
      }
      if (this.playerElements.nextButton !== null) {
        this.playerElements.nextButton.addEventListener("click", () => this.handlePlayerNext());
      }
      if (this.playerElements.stepButton !== null) {
        this.playerElements.stepButton.addEventListener("click", () => this.advanceRound3Step());
      }
      if (this.playerElements.exitModal !== null) {
        this.playerElements.exitModal.addEventListener("click", (event) => {
          const action = event.target.closest("[data-action='close']");
          if (action !== null || event.target === this.playerElements.exitModal) {
            this.closePlayerExitModal();
          }
        });
      }
      if (this.playerElements.closeExitModalButton !== null) {
        this.playerElements.closeExitModalButton.addEventListener("click", () => {
          this.closePlayerExitModal();
        });
      }
      if (this.playerElements.cancelExitButton !== null) {
        this.playerElements.cancelExitButton.addEventListener("click", () => {
          this.closePlayerExitModal();
        });
      }
      if (this.playerElements.confirmExitButton !== null) {
        this.playerElements.confirmExitButton.addEventListener("click", () => {
          this.confirmPlayerExit();
        });
      }
      document.addEventListener("keydown", (event) => this.handlePlayerKeydown(event));
    }

    async init() {
      if (this.page === "home") {
        await this.refreshBlindtests();
        return;
      }

      if (this.page === "scan") {
        await this.refreshScanStatus();
        if (this.scanState.status === "running" || this.scanState.status === "stopping") {
          this.startScanPolling();
        }
        return;
      }

      if (this.page === "editor") {
        await this.loadSongs();
        await this.loadEditorBlindtest();
        this.renderEditorPage();
        return;
      }

      if (this.page === "player") {
        await this.loadSongs();
        this.initPlayerFromStorage();
      }
    }

    async loadSongs() {
      const response = await fetch("/api/songs");
      const payload = await response.json();
      this.librarySongs = payload.songs || [];
      this.librarySongMap = new Map(this.librarySongs.map((song) => [song.id, song]));
    }

    async loadEditorBlindtest() {
      const restoredDraft = this.consumeEditorDraftRestore();
      if (restoredDraft !== null) {
        this.hydrateBlindtest(restoredDraft);
        return;
      }

      if (Number.isFinite(this.pageBlindtestId)) {
        const response = await fetch(`/api/blindtest/${this.pageBlindtestId}`);
        const payload = await response.json();
        this.hydrateBlindtest(payload.blindtest);
        return;
      }

      this.hydrateBlindtest(null);
    }

    initPlayerFromStorage() {
      const playerDraft = readSessionJson(PLAYER_DRAFT_STORAGE_KEY);
      if (playerDraft === null) {
        this.renderPlayerDraftMissing();
        return;
      }

      this.hydrateBlindtest(playerDraft);
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

    renderEditorPage() {
      this.renderSettings();
      this.renderSongList();
      this.renderLibrary();
      this.renderBackgroundGallery();
      this.renderEditor();
    }

    toggleSidebarPanel(panelName) {
      this.setSidebarPanel(this.activeSidebarPanel === panelName ? null : panelName);
    }

    setSidebarPanel(panelName) {
      this.activeSidebarPanel =
        panelName === "library" || panelName === "backgrounds" ? panelName : null;
      const isLibraryVisible = this.activeSidebarPanel === "library";
      const isBackgroundsVisible = this.activeSidebarPanel === "backgrounds";
      if (this.elements.libraryPanel !== null) {
        this.elements.libraryPanel.hidden = !isLibraryVisible;
      }
      if (this.elements.backgroundsPanel !== null) {
        this.elements.backgroundsPanel.hidden = !isBackgroundsVisible;
      }
      if (this.elements.editorLayout !== null) {
        this.elements.editorLayout.classList.toggle(
          "sidebar-open",
          this.activeSidebarPanel !== null
        );
      }
      if (this.elements.toggleLibraryButton !== null) {
        this.elements.toggleLibraryButton.textContent = isLibraryVisible
          ? "Hide library"
          : "Show library";
        this.elements.toggleLibraryButton.classList.toggle("is-active", isLibraryVisible);
      }
      if (this.elements.toggleBackgroundPanelButton !== null) {
        this.elements.toggleBackgroundPanelButton.textContent = isBackgroundsVisible
          ? "Hide backgrounds"
          : "Show backgrounds";
        this.elements.toggleBackgroundPanelButton.classList.toggle(
          "is-active",
          isBackgroundsVisible
        );
      }
      if (this.wavesurfer !== null) {
        window.requestAnimationFrame(() => this.resetZoom());
      }
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
          slot_status: song.slot_status || (song.song_id === null ? "missing" : "ok"),
          start_sec: song.start_sec,
          duration_sec: song.duration_sec,
          source_title: song.source_title || "",
          source_artist: song.source_artist || "",
          source_album: song.source_album || "",
          source_year: song.source_year ?? "",
          source_genre: song.source_genre || "",
          source_background: song.source_background || song.source_cover || "",
          override_title: song.override_title || "",
          override_artist: song.override_artist || "",
          override_album: song.override_album || "",
          override_year: song.override_year ?? "",
          override_genre: song.override_genre || "",
          override_background: song.override_background || song.override_cover || "",
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

    isSlotMissing(slot) {
      return slot.slot_status === "missing";
    }

    isSlotPending(slot) {
      return slot.song_id === null && slot.slot_status === "pending";
    }

    getSlotSource(slot) {
      const librarySource =
        slot.song_id === null ? null : this.librarySongMap.get(slot.song_id) || null;
      return {
        title: normalizeText(slot.source_title) || normalizeText(librarySource && librarySource.title),
        artist:
          normalizeText(slot.source_artist) || normalizeText(librarySource && librarySource.artist),
        album:
          normalizeText(slot.source_album) || normalizeText(librarySource && librarySource.album),
        year:
          slot.source_year !== "" && slot.source_year !== null && slot.source_year !== undefined
            ? slot.source_year
            : librarySource && librarySource.year,
        genre:
          normalizeText(slot.source_genre) || normalizeText(librarySource && librarySource.genre),
        background_image: normalizeText(slot.source_background),
        cover_path: normalizeText(librarySource && librarySource.cover_path),
      };
    }

    getSlotCoverPath(slot) {
      if (slot === null || slot.song_id === null) {
        return "";
      }
      const librarySource = this.librarySongMap.get(slot.song_id) || null;
      return normalizeText(librarySource && librarySource.cover_path) || "";
    }

    snapshotFromLibrarySong(songId) {
      const song = this.librarySongMap.get(songId) || null;
      return {
        source_title: normalizeText(song && song.title),
        source_artist: normalizeText(song && song.artist),
        source_album: normalizeText(song && song.album),
        source_year:
          song && song.year !== null && song.year !== undefined ? song.year : "",
        source_genre: normalizeText(song && song.genre),
        source_background: "",
      };
    }

    renderAll() {
      this.renderHome();
      this.renderScan();
      this.renderSettings();
      this.renderSongList();
      this.renderLibrary();
      this.renderBackgroundGallery();
      this.renderEditor();
    }

    renderHome() {
      const list = this.elements.homeBlindtestList;
      list.innerHTML = "";
      const blindtests = this.homeBlindtests
        .slice()
        .sort((left, right) => blindtestUpdatedAtValue(right) - blindtestUpdatedAtValue(left));
      if (blindtests.length === 0) {
        return;
      }

      for (const blindtest of blindtests) {
        const item = document.createElement("article");
        item.className = "home-blindtest-card";
        item.innerHTML = `
          <div class="home-blindtest-meta">
            <div class="home-blindtest-title">${this.escapeHtml(blindtest.title || "Untitled blindtest")}</div>
            <div class="home-blindtest-updated">${this.escapeHtml(this.formatUpdatedAt(blindtest.updated_at))}</div>
          </div>
          <button class="button-secondary button-compact" type="button">Open</button>
        `;
        const button = item.querySelector("button");
        button.addEventListener("click", () => {
          this.openBlindtest(blindtest.id).catch(() => {});
        });
        list.appendChild(item);
      }
    }

    renderScan() {
      const state = this.scanState || { status: "idle", summary: null, error: null };
      const summary = state.summary || null;
      const isRunning = state.status === "running" || state.status === "stopping";
      this.elements.scanToggleButton.textContent = isRunning ? "Stop scan" : "Start scan";
      this.elements.scanToggleButton.classList.toggle("button-danger", isRunning);
      this.elements.scanToggleButton.classList.toggle("button-primary", !isRunning);
      this.elements.scanStatus.textContent = this.formatScanStatus(state.status);
      this.elements.scanStatus.dataset.state = normalizeText(state.error)
        ? "error"
        : state.status || "idle";
      this.elements.scanError.hidden = !normalizeText(state.error);
      this.elements.scanError.textContent = normalizeText(state.error);
      this.elements.scanAddedCount.textContent = String((summary && summary.added) || 0);
      this.elements.scanRemovedCount.textContent = String((summary && summary.removed) || 0);
      this.elements.scanImpactList.innerHTML = "";
      const impactedBlindtests = (summary && summary.impacted_blindtests) || [];
      this.elements.scanImpactEmpty.hidden = impactedBlindtests.length > 0;
      for (const blindtest of impactedBlindtests) {
        const item = document.createElement("div");
        item.className = "scan-impact-item";
        item.textContent = blindtest.title || `Blindtest ${blindtest.id}`;
        this.elements.scanImpactList.appendChild(item);
      }
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
        const source = this.getSlotSource(slot);
        const missing = this.isSlotMissing(slot);
        const pending = this.isSlotPending(slot);
        const card = document.createElement("article");
        card.className = "song-card";
        card.draggable = true;
        card.dataset.slotId = String(slot.slot_id);
        if (missing) {
          card.classList.add("missing");
        }
        if (pending) {
          card.classList.add("pending");
        }
        if (slot.slot_id === this.activeSlotId) {
          card.classList.add("active");
        }

        const cover = this.createCoverThumb(pending ? { title: "+" } : source);
        const body = document.createElement("div");
        const title =
          pending
            ? "New song slot"
            : normalizeText(slot.override_title) ||
              normalizeText(source.title) ||
              "Missing song";
        const artist =
          pending
            ? "Open the library to add songs."
            : normalizeText(slot.override_artist) || normalizeText(source.artist);
        const statusLine = missing
          ? '<div class="song-card-status">Missing audio</div>'
          : "";
        body.innerHTML = `
          <div class="song-card-header">
            <div class="song-card-meta">
              <div class="song-card-title">${this.escapeHtml(title)}</div>
              <div class="song-card-subtitle">${this.escapeHtml(artist || "Unknown artist")}</div>
              ${statusLine}
            </div>
          </div>
          <div class="song-card-times">${this.escapeHtml(
            formatCardDuration(slot.start_sec, slot.duration_sec)
          )}</div>
          <div class="song-card-actions">
            <button class="button-secondary button-compact" type="button" data-action="edit">Edit</button>
            <button class="button-danger button-compact" type="button" data-action="remove">Remove</button>
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
              this.showRemoveSongModal(slot.slot_id);
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

    renderBackgroundGallery() {
      if (this.elements.backgroundGallery === null) {
        return;
      }

      const slot = this.getActiveSlot();
      const canAssignBackground = slot !== null && !this.isSlotPending(slot);
      const currentBackground = canAssignBackground
        ? normalizeText(slot.override_background)
        : "";
      this.elements.backgroundGallery.innerHTML = "";

      if (this.backgroundGallery.length === 0) {
        const empty = document.createElement("div");
        empty.className = "background-gallery-empty";
        empty.textContent = "No backgrounds available.";
        this.elements.backgroundGallery.appendChild(empty);
        return;
      }

      for (const background of this.backgroundGallery) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "library-item cover-choice";
        if (normalizeText(background.url) === currentBackground) {
          button.classList.add("is-active");
        }
        button.disabled = !canAssignBackground;
        const thumb = this.createImageThumb(
          background.url,
          background.name || "Background"
        );
        const body = document.createElement("div");
        body.innerHTML = `
          <div class="library-item-header">
            <div class="library-item-meta">
              <div class="library-item-title">${this.escapeHtml(background.name || "Background")}</div>
              <div class="library-item-subtitle">Preset background</div>
              <div class="library-item-details">Click to use this image</div>
            </div>
          </div>
        `;
        button.appendChild(thumb);
        button.appendChild(body);
        button.addEventListener("click", () =>
          this.applyBackgroundSelection(background.url)
        );
        this.elements.backgroundGallery.appendChild(button);
      }
    }

    renderEditor() {
      const slot = this.getActiveSlot();
      this.renderBackgroundGallery();
      if (slot === null) {
        this.showEditorEmpty();
        return;
      }
      if (this.isSlotPending(slot)) {
        this.showEditorEmpty("Open the library to add songs.", false);
        return;
      }

      this.elements.songEditorContent.hidden = false;
      this.fillMetadataForm(slot);
      this.renderCoverDisplay(slot);
      this.loadSlotWaveform(slot).catch(() => {
        this.showAudioError();
      });
    }

    fillMetadataForm(slot) {
      const source = this.getSlotSource(slot);
      this.elements.overrideTitle.value = slot.override_title || "";
      this.elements.overrideArtist.value = slot.override_artist || "";
      this.elements.overrideAlbum.value = slot.override_album || "";
      this.elements.overrideYear.value = slot.override_year === "" ? "" : slot.override_year;
      this.elements.overrideGenre.value = slot.override_genre || "";
      this.elements.overrideBackground.value = slot.override_background || "";
      this.elements.customHint.value = slot.custom_hint || "";
      this.elements.overrideTitle.placeholder = normalizeText(source.title);
      this.elements.overrideArtist.placeholder = normalizeText(source.artist);
      this.elements.overrideAlbum.placeholder = normalizeText(source.album);
      this.elements.overrideYear.placeholder =
        source.year === null || source.year === undefined ? "" : String(source.year);
      this.elements.overrideGenre.placeholder = normalizeText(source.genre);
      this.elements.overrideBackground.placeholder = "";
      this.updateClearBackgroundButtonState();
      this.updateBackgroundPreviewButtonState();
    }

    renderCoverDisplay(slot) {
      if (slot === null) {
        this.showCoverDisplayStatus("No target song selected.");
        return;
      }
      if (this.isSlotPending(slot)) {
        this.showCoverDisplayStatus("Open the library to add a song.");
        return;
      }
      if (this.isSlotMissing(slot) || slot.song_id === null) {
        this.showCoverDisplayStatus("Cover unavailable.");
        return;
      }

      const existingCover = this.getSlotCoverPath(slot);
      if (existingCover) {
        this.showCoverDisplayImage(existingCover, slot);
        return;
      }

      this.showCoverDisplayStatus("No extracted cover.");
    }

    showCoverDisplayStatus(message) {
      if (this.elements.coverDisplayStatus !== null) {
        this.elements.coverDisplayStatus.hidden = false;
        this.elements.coverDisplayStatus.textContent = message;
      }
      if (this.elements.coverDisplayImage !== null) {
        this.elements.coverDisplayImage.hidden = true;
        this.elements.coverDisplayImage.removeAttribute("src");
      }
    }

    showCoverDisplayImage(imageUrl, slot) {
      if (this.elements.coverDisplayStatus !== null) {
        this.elements.coverDisplayStatus.hidden = true;
      }
      if (this.elements.coverDisplayImage !== null) {
        this.elements.coverDisplayImage.hidden = false;
        this.elements.coverDisplayImage.src = imageUrl;
        const source = this.getSlotSource(slot);
        const title =
          normalizeText(slot.override_title) ||
          normalizeText(source.title) ||
          "target song";
        this.elements.coverDisplayImage.alt = `Cover for ${title}`;
      }
    }

    async loadSlotWaveform(slot) {
      if (this.isSlotMissing(slot)) {
        this.currentLoadedSongId = null;
        this.destroyWaveform();
        this.pendingStart = slot.start_sec;
        this.selectionEnd =
          Number.isFinite(slot.start_sec) && Number.isFinite(slot.duration_sec)
            ? slot.start_sec + slot.duration_sec
            : null;
        this.updateDisplays();
        this.updateMarkLabel();
        this.showAudioError();
        return;
      }

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
      const requestedSongId = slot.song_id;
      this.destroyWaveform();
      this.pendingStart = slot.start_sec;
      this.selectionEnd =
        Number.isFinite(slot.start_sec) && Number.isFinite(slot.duration_sec)
          ? slot.start_sec + slot.duration_sec
          : null;
      this.currentZoom = DEFAULT_ZOOM;
      this.hideError();
      this.updateDisplays();
      this.clearWaveformPlaceholder();
      this.setWaveformControlsDisabled(true);

      await this.ensureWaveLibraries();
      if (this.currentLoadedSongId !== requestedSongId) {
        return;
      }

      this.regions = this.regionsLib.create();
      this.wavesurfer = this.waveSurferLib.create({
        container: "#waveform",
        height: 120,
        mediaControls: true,
        url: `/api/audio/${slot.song_id}`,
        plugins: [this.regions],
      });
      this.regions.on("region-updated", (region) => this.syncSelectionFromRegion(region));
      this.regions.on("region-update-end", (region) => this.syncSelectionFromRegion(region));
      this.wavesurfer.on("timeupdate", () => {
        this.updateDisplays();
        this.updateMarkLabel();
      });
      this.wavesurfer.on("interaction", () => {
        this.handleWaveInteraction();
      });
      this.wavesurfer.on("ready", () => {
        this.hideError();
        this.resetZoom();
        this.setWaveformControlsDisabled(false);
        this.renderCurrentSelection();
        this.updateDisplays();
        this.updateMarkLabel();
      });
      this.wavesurfer.on("error", () => this.showAudioError());
    }

    createImageThumb(imageUrl, label = "Background") {
      const thumb = document.createElement("div");
      thumb.className = "cover-thumb cover-thumb-image";
      const image = document.createElement("img");
      image.src = imageUrl;
      image.alt = label;
      thumb.appendChild(image);
      return thumb;
    }

    destroyWaveform() {
      if (this.wavesurfer !== null) {
        this.wavesurfer.destroy();
      }
      this.wavesurfer = null;
      this.regions = null;
    }

    showEditorEmpty(message = "", clearSelection = true) {
      if (clearSelection) {
        this.activeSlotId = null;
      }
      this.currentLoadedSongId = null;
      this.elements.songEditorContent.hidden = true;
      this.destroyWaveform();
      this.pendingStart = null;
      this.selectionEnd = null;
      this.updateDisplays();
      this.updateMarkLabel();
      this.showPlaceholder(message);
      this.hideError();
      this.setWaveformControlsDisabled(true);
      this.showCoverDisplayStatus(message ? "Cover unavailable." : "No target song selected.");
      this.updateClearBackgroundButtonState();
      this.updateBackgroundPreviewButtonState();
    }

    showPlaceholder(message) {
      if (!message) {
        this.clearWaveformPlaceholder();
        return;
      }
      this.elements.waveform.innerHTML = `<div class="waveform-empty">${this.escapeHtml(
        message
      )}</div>`;
    }

    clearWaveformPlaceholder() {
      this.elements.waveform.innerHTML = "";
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
      const minimumZoom = this.getFitZoom();
      this.currentZoom = clamp(value, minimumZoom, MAX_ZOOM);
      if (this.wavesurfer !== null) {
        this.wavesurfer.zoom(this.currentZoom);
      }
    }

    getFitZoom() {
      if (this.wavesurfer === null) {
        return MIN_ZOOM;
      }

      const duration = this.wavesurfer.getDuration();
      const containerWidth =
        (this.elements.waveWrap && this.elements.waveWrap.clientWidth) ||
        (this.elements.waveform && this.elements.waveform.clientWidth) ||
        0;
      if (!duration || !containerWidth) {
        return DEFAULT_ZOOM;
      }

      return Math.max(MIN_ZOOM, containerWidth / duration);
    }

    resetZoom() {
      this.setZoom(this.getFitZoom());
    }

    getActiveSlot() {
      return this.blindtest.songs.find((slot) => slot.slot_id === this.activeSlotId) || null;
    }

    setActiveSlot(slotId) {
      this.activeSlotId = slotId;
      this.renderSongList();
      this.renderEditor();
    }

    appendPendingSlot() {
      const slot = this.createSlot(null, this.blindtest.songs.length);
      this.blindtest.songs.push(slot);
      this.reindexSongs();
      this.setActiveSlot(slot.slot_id);
      this.setSidebarPanel("library");
      if (this.elements.librarySearch !== null) {
        this.elements.librarySearch.focus();
      }
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
        slot_status: songId === null ? "pending" : "ok",
        start_sec: null,
        duration_sec: null,
        ...this.snapshotFromLibrarySong(songId),
        override_title: "",
        override_artist: "",
        override_album: "",
        override_year: "",
        override_genre: "",
        override_background: "",
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

    showRemoveSongModal(slotId) {
      const slot = this.blindtest.songs.find((item) => item.slot_id === slotId) || null;
      if (
        slot === null ||
        this.elements.removeSongModal === null ||
        this.elements.removeSongModalCopy === null
      ) {
        return;
      }

      const source = this.getSlotSource(slot);
      const title =
        this.isSlotPending(slot)
          ? "this pending slot"
          : normalizeText(slot.override_title) ||
            normalizeText(source.title) ||
            "this song";
      const artist =
        normalizeText(slot.override_artist) ||
        normalizeText(source.artist) ||
        "";
      this.pendingRemoveSlotId = slotId;
      this.elements.removeSongModalCopy.textContent = artist
        ? `Remove "${title}" by ${artist} from the song list?`
        : `Remove "${title}" from the song list?`;
      this.elements.removeSongModal.hidden = false;
      document.body.classList.add("modal-open");
      this.elements.confirmRemoveSongButton.focus();
    }

    hideRemoveSongModal() {
      this.pendingRemoveSlotId = null;
      if (this.elements.removeSongModal !== null) {
        this.elements.removeSongModal.hidden = true;
      }
      document.body.classList.remove("modal-open");
    }

    confirmRemoveSlot() {
      if (this.pendingRemoveSlotId === null) {
        return;
      }
      const slotId = this.pendingRemoveSlotId;
      this.hideRemoveSongModal();
      this.removeSlot(slotId);
    }

    getCurrentBackgroundPreviewPath() {
      return normalizeText(this.elements.overrideBackground.value);
    }

    updateBackgroundPreviewButtonState() {
      if (this.elements.previewBackgroundButton === null) {
        return;
      }
      this.elements.previewBackgroundButton.disabled = !this.getCurrentBackgroundPreviewPath();
    }

    updateClearBackgroundButtonState() {
      if (this.elements.clearBackgroundButton === null) {
        return;
      }
      const slot = this.getActiveSlot();
      this.elements.clearBackgroundButton.disabled =
        slot === null ||
        this.isSlotPending(slot) ||
        !normalizeText(this.elements.overrideBackground.value);
    }

    showBackgroundPreviewModal() {
      const imagePath = this.getCurrentBackgroundPreviewPath();
      if (
        !imagePath ||
        this.elements.backgroundPreviewModal === null ||
        this.elements.backgroundPreviewImage === null
      ) {
        return;
      }
      this.elements.backgroundPreviewImage.src = imagePath;
      this.elements.backgroundPreviewImage.alt = "Background preview";
      this.elements.backgroundPreviewModal.hidden = false;
      document.body.classList.add("modal-open");
      if (this.elements.closeBackgroundPreviewModalButton !== null) {
        this.elements.closeBackgroundPreviewModalButton.focus();
      }
    }

    hideBackgroundPreviewModal() {
      if (this.elements.backgroundPreviewModal !== null) {
        this.elements.backgroundPreviewModal.hidden = true;
      }
      if (this.elements.backgroundPreviewImage !== null) {
        this.elements.backgroundPreviewImage.removeAttribute("src");
      }
      document.body.classList.remove("modal-open");
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
      if (field === "override_background") {
        this.renderBackgroundGallery();
        this.updateBackgroundPreviewButtonState();
      }
    }

    applyBackgroundSelection(backgroundUrl) {
      const slot = this.getActiveSlot();
      if (slot === null || this.isSlotPending(slot)) {
        return;
      }

      slot.override_background = normalizeText(backgroundUrl);
      this.elements.overrideBackground.value = slot.override_background;
      this.renderSongList();
      this.renderBackgroundGallery();
      this.updateClearBackgroundButtonState();
      this.updateBackgroundPreviewButtonState();
    }

    clearBackgroundSelection() {
      const slot = this.getActiveSlot();
      if (slot === null || this.isSlotPending(slot)) {
        return;
      }

      slot.override_background = "";
      this.elements.overrideBackground.value = "";
      this.renderSongList();
      this.renderBackgroundGallery();
      this.updateClearBackgroundButtonState();
      this.updateBackgroundPreviewButtonState();
    }

    handleMark() {
      if (this.wavesurfer === null) {
        return;
      }

      const duration = this.wavesurfer.getDuration();
      const current = clamp(this.wavesurfer.getCurrentTime(), 0, duration || 0);
      this.applyMarkAtTime(current);
    }

    handleWaveInteraction() {
      if (this.wavesurfer === null) {
        return;
      }

      const duration = this.wavesurfer.getDuration();
      const current = clamp(this.wavesurfer.getCurrentTime(), 0, duration || 0);
      this.applyMarkAtTime(current);
    }

    applyMarkAtTime(timeSec) {
      if (this.pendingStart === null) {
        this.pendingStart = timeSec;
        this.selectionEnd = null;
        this.renderPendingRegion();
        return;
      }

      if (this.selectionEnd === null) {
        if (timeSec < this.pendingStart) {
          this.pendingStart = timeSec;
          this.renderPendingRegion();
          return;
        }

        this.selectionEnd = timeSec;
        if (this.selectionEnd <= this.pendingStart) {
          this.selectionEnd = this.pendingStart + MIN_REGION_SPAN;
        }
        this.renderSelectionRegion();
        return;
      }

      const boundary = this.pickBoundaryToMove(timeSec);
      if (boundary === "start") {
        this.pendingStart = timeSec;
      } else {
        this.selectionEnd = timeSec;
      }

      this.correctSelection();
      this.renderSelectionRegion();
    }

    pickBoundaryToMove(timeSec) {
      if (
        this.pendingStart === null ||
        this.selectionEnd === null ||
        this.selectionEnd <= this.pendingStart
      ) {
        return "end";
      }

      if (timeSec <= this.pendingStart) {
        return "start";
      }
      if (timeSec >= this.selectionEnd) {
        return "end";
      }

      const relative = (timeSec - this.pendingStart) / (this.selectionEnd - this.pendingStart);
      return relative <= 1 / 4 ? "start" : "end";
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
      this.regions.clearRegions();
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
      this.regions.clearRegions();
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

    formatScanStatus(status) {
      if (status === "running") {
        return "Scan running";
      }
      if (status === "stopping") {
        return "Scan stopping";
      }
      if (status === "error") {
        return "Scan error";
      }
      return "Idle";
    }

    formatUpdatedAt(value) {
      const normalized = normalizeText(value);
      if (!normalized) {
        return "Updated date unavailable";
      }
      const parsed = new Date(normalized);
      if (Number.isNaN(parsed.getTime())) {
        return normalized;
      }
      return `Updated ${parsed.toLocaleString()}`;
    }

    getEditorPath() {
      if (Number.isFinite(this.blindtest.id)) {
        return `/editor/${this.blindtest.id}`;
      }
      return "/editor/new";
    }

    clearPendingPlayerDraft() {
      window.sessionStorage.removeItem(PLAYER_DRAFT_STORAGE_KEY);
      window.sessionStorage.removeItem(PLAYER_RETURN_URL_STORAGE_KEY);
      window.sessionStorage.removeItem(RESTORE_EDITOR_DRAFT_STORAGE_KEY);
    }

    consumeEditorDraftRestore() {
      const shouldRestore =
        window.sessionStorage.getItem(RESTORE_EDITOR_DRAFT_STORAGE_KEY) === "1";
      const returnUrl = window.sessionStorage.getItem(PLAYER_RETURN_URL_STORAGE_KEY);
      const draft = readSessionJson(PLAYER_DRAFT_STORAGE_KEY);
      if (!shouldRestore || !returnUrl || returnUrl !== window.location.pathname || draft === null) {
        return null;
      }

      window.sessionStorage.removeItem(RESTORE_EDITOR_DRAFT_STORAGE_KEY);
      return draft;
    }

    renderPlayerDraftMissing() {
      this.currentView = "player";
      this.playerElements.panelLabel.textContent = "Unavailable";
      this.playerElements.mainTitle.textContent = "BLINDUP";
      this.playerElements.subtitle.textContent = "Open the player from the editor.";
      this.playerElements.position.textContent = "";
      this.playerElements.hints.hidden = true;
      this.clearPlayerAnswer();
      this.playerElements.countdown.hidden = true;
      this.playerElements.error.hidden = true;
      this.playerElements.stepButton.hidden = true;
    }

    async refreshBlindtests() {
      const response = await fetch("/api/blindtests");
      const payload = await response.json();
      this.homeBlindtests = payload.blindtests || [];
      this.renderHome();
    }

    async refreshSongs() {
      await this.loadSongs();
      if (this.elements.libraryList !== null) {
        this.renderLibrary();
      }
    }

    async handleScanToggle() {
      const status = this.scanState.status;
      if (status === "running" || status === "stopping") {
        await fetch("/api/library/scan/stop", {
          method: "POST",
        });
        await this.refreshScanStatus();
        this.startScanPolling();
        return;
      }

      await fetch("/api/library/scan/start", {
        method: "POST",
      });
      await this.refreshScanStatus();
      this.startScanPolling();
    }

    async refreshScanStatus() {
      const response = await fetch("/api/library/scan/status");
      const payload = await response.json();
      this.scanState = {
        status: payload.status || "idle",
        summary: payload.summary || null,
        error: payload.error || null,
      };
      const summaryKey = JSON.stringify(this.scanState.summary || {});
      if (
        this.scanState.status === "idle" &&
        this.scanState.summary !== null &&
        summaryKey !== this.latestScanSummaryKey
      ) {
        this.latestScanSummaryKey = summaryKey;
        await this.refreshSongs();
      }
      this.renderScan();
    }

    startScanPolling() {
      this.stopScanPolling();
      this.scanPollInterval = window.setInterval(() => {
        this.refreshScanStatus()
          .then(() => {
            if (
              this.scanState.status !== "running" &&
              this.scanState.status !== "stopping"
            ) {
              this.stopScanPolling();
            }
          })
          .catch(() => {
            this.stopScanPolling();
          });
      }, 600);
    }

    stopScanPolling() {
      if (this.scanPollInterval !== null) {
        window.clearInterval(this.scanPollInterval);
        this.scanPollInterval = null;
      }
    }

    async openBlindtest(blindtestId) {
      this.clearPendingPlayerDraft();
      window.location.assign(`/editor/${blindtestId}`);
    }

    startNewBlindtest() {
      this.clearPendingPlayerDraft();
      window.location.assign("/editor/new");
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
              slot_status: slot.slot_status,
              start_sec: slot.start_sec,
              duration_sec: slot.duration_sec,
              source_title: normalizeText(slot.source_title) || null,
              source_artist: normalizeText(slot.source_artist) || null,
              source_album: normalizeText(slot.source_album) || null,
              source_year: slot.source_year === "" ? null : numberOrNull(slot.source_year),
              source_genre: normalizeText(slot.source_genre) || null,
              source_background: normalizeText(slot.source_background) || null,
              override_title: normalizeText(slot.override_title) || null,
              override_artist: normalizeText(slot.override_artist) || null,
              override_album: normalizeText(slot.override_album) || null,
            override_year: slot.override_year === "" ? null : numberOrNull(slot.override_year),
            override_genre: normalizeText(slot.override_genre) || null,
            override_background: normalizeText(slot.override_background) || null,
            custom_hint: normalizeText(slot.custom_hint) || null,
          })),
        }),
      });
      const payload = await response.json();
      this.hydrateBlindtest(payload.blindtest);
      window.history.replaceState({}, "", this.getEditorPath());
      document.body.dataset.editorMode = "existing";
      document.body.dataset.blindtestId = String(this.blindtest.id);
      this.pageBlindtestId = this.blindtest.id;
      this.renderEditorPage();
    }

    showHomeView() {
      this.clearPendingPlayerDraft();
      window.location.assign("/home");
    }

    showScanView() {
      this.clearPendingPlayerDraft();
      window.location.assign("/scan");
    }

    showEditorView() {
      if (this.page === "player") {
        window.sessionStorage.setItem(RESTORE_EDITOR_DRAFT_STORAGE_KEY, "1");
        const returnUrl =
          window.sessionStorage.getItem(PLAYER_RETURN_URL_STORAGE_KEY) || "/editor/new";
        window.location.assign(returnUrl);
        return;
      }

      window.location.assign(this.getEditorPath());
    }

    showPlayerView() {
      this.currentView = "player";
      this.elements.pageTitle.textContent = "Blindtest player";
    }

    launchPlayer() {
      window.sessionStorage.setItem(
        PLAYER_DRAFT_STORAGE_KEY,
        JSON.stringify(this.blindtest)
      );
      window.sessionStorage.setItem(PLAYER_RETURN_URL_STORAGE_KEY, this.getEditorPath());
      window.sessionStorage.setItem(RESTORE_EDITOR_DRAFT_STORAGE_KEY, "1");
      window.location.assign("/player");
    }

    buildPlayerSongs() {
      return this.blindtest.songs.map((slot) => {
        const source = this.getSlotSource(slot);
        return {
          ...slot,
          source,
        };
      });
    }

    handlePlayerKeydown(event) {
      if (this.currentView !== "player") {
        return;
      }
      if (this.isPlayerExitModalOpen()) {
        if (event.key === "Escape") {
          event.preventDefault();
          this.closePlayerExitModal();
        }
        return;
      }
      if (this.playerState === null) {
        return;
      }
      if (event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }

      const key = event.key;
      if (key === " ") {
        event.preventDefault();
        this.togglePlayerPlayback();
        return;
      }
      if (key === "ArrowRight" || key === "ArrowDown") {
        event.preventDefault();
        this.handlePlayerNext();
        return;
      }
      if (key === "ArrowLeft" || key === "ArrowUp" || key === "Backspace") {
        event.preventDefault();
        this.handlePlayerPrevious();
        return;
      }
      if (key === "Escape") {
        event.preventDefault();
        this.handlePlayerEscapeShortcut();
        return;
      }
      if (key.toLowerCase() === "i" || key.toLowerCase() === "h") {
        event.preventDefault();
        this.togglePlayerHints();
        return;
      }
      if (key.toLowerCase() === "a") {
        event.preventDefault();
        this.togglePlayerAuto();
        return;
      }
      if (key.toLowerCase() === "q") {
        event.preventDefault();
        this.openPlayerExitModal();
        return;
      }
      if (key === "Enter" || key.toLowerCase() === "n" || key.toLowerCase() === "d") {
        event.preventDefault();
        this.advanceRound3Step();
      }
    }

    isPlayerExitModalOpen() {
      return (
        this.playerElements.exitModal !== null &&
        this.playerElements.exitModal.hidden === false
      );
    }

    openPlayerExitModal() {
      if (this.playerElements.exitModal === null || this.isPlayerExitModalOpen()) {
        return;
      }

      this.playerExitReturnFocus =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      this.playerElements.exitModal.hidden = false;
      document.body.classList.add("modal-open");
      if (this.playerElements.cancelExitButton !== null) {
        this.playerElements.cancelExitButton.focus();
      }
    }

    closePlayerExitModal() {
      if (this.playerElements.exitModal === null || !this.isPlayerExitModalOpen()) {
        return;
      }

      this.playerElements.exitModal.hidden = true;
      document.body.classList.remove("modal-open");
      if (this.playerExitReturnFocus instanceof HTMLElement) {
        this.playerExitReturnFocus.focus();
      }
      this.playerExitReturnFocus = null;
    }

    confirmPlayerExit() {
      this.closePlayerExitModal();
      this.showEditorView();
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

    handlePlayerEscapeShortcut() {
      if (this.playerState === null) {
        return;
      }

      if (this.playerState.hints_visible) {
        this.togglePlayerHints();
        return;
      }

      this.openPlayerExitModal();
    }

    togglePlayerPlayback() {
      if (
        this.playerState === null ||
        this.playerState.panel !== "La la la..." ||
        this.playerTeaserSession === null ||
        this.playerTeaserSession.status === "finished"
      ) {
        return;
      }

      if (this.playerTeaserSession.status === "paused") {
        this.resumeTeaserSession();
        return;
      }

      this.pauseTeaserSession();
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

      if (this.playerState.panel === "end") {
        this.openPlayerExitModal();
        return;
      }

      if (this.playerState.panel === "waiting") {
        this.pushPlayerHistory();
        if (this.getSongsForRound(1).length === 0) {
          this.playerState.panel = "end";
        } else {
          this.playerState.panel = "La la la...";
        }
        this.playerState.current_round = 1;
        this.playerState.current_song_index = 0;
        this.playerState.round3_step_index = 0;
        this.enterCurrentPlayerPanel();
        return;
      }

      if (this.playerState.panel === "round_transition") {
        this.pushPlayerHistory();
        this.playerState.panel = "La la la...";
        this.playerState.current_song_index = 0;
        this.playerState.round3_step_index = 0;
        this.enterCurrentPlayerPanel();
        return;
      }

      if (this.playerState.panel === "La la la...") {
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
        this.playerState.panel = "La la la...";
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
        this.playerState.panel !== "La la la..." ||
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

      if (this.playerState === null) {
        this.playerTeaserSession = null;
        this.updatePlayerControls();
        return;
      }

      if (this.playerState.panel !== "La la la...") {
        this.playerTeaserSession = null;
      }
      this.updatePlayerControls();

      const song = this.getCurrentPlayerSong();
      if (this.playerState.panel === "waiting") {
        this.setPlayerBackground(this.blindtest.background_image);
        this.playerElements.panelLabel.textContent = "Waiting";
        this.setPlayerMainTitleText(this.blindtest.title || "BLINDUP");
        return;
      }

      if (this.playerState.panel === "round_transition") {
        this.setPlayerBackground(this.blindtest.background_image);
        this.playerElements.panelLabel.textContent = "Round transition";
        this.setPlayerMainTitleText(
          ROUND_TRANSITION_TITLES[this.playerState.current_round] || "Round"
        );
        return;
      }

      if (this.playerState.panel === "La la la...") {
        this.setPlayerBackground(
          this.getSongBackground(song) || this.blindtest.background_image
        );
        this.playerElements.panelLabel.textContent = "La la la...";
        this.setPlayerMainTitleText(this.getPlayerModeLabel());
        if (this.playerState.current_round === 3) {
          this.renderPlayerStageMeta(
            `Step ${this.playerState.round3_step_index + 1} / ${this.getRound3Steps().length}`
          );
        }
        if (song !== null) {
          this.startTeaserPanel(this.playerPanelToken, song);
        }
        return;
      }

      if (this.playerState.panel === "answer") {
        this.setPlayerBackground(
          this.getSongBackground(song) || this.blindtest.background_image
        );
        this.playerElements.panelLabel.textContent = "Answer";
        if (song !== null) {
          this.fillPlayerAnswer(song);
          this.startAnswerPanel(this.playerPanelToken, song);
        }
        return;
      }

      this.setPlayerBackground(this.blindtest.background_image);
      this.playerElements.panelLabel.textContent = "End";
      this.renderPlayerMainLogo();
    }

    renderPlayerBase() {
      this.clearPlayerStageMeta();
      this.clearPlayerAnswer();
      this.playerElements.hints.hidden = true;
      this.playerElements.hints.innerHTML = "";
      this.playerElements.countdown.hidden = true;
      this.playerElements.countdown.textContent = "";
      this.playerElements.error.hidden = true;
      this.playerElements.roundLabel.textContent = "Blindtest player";
      this.playerElements.position.textContent = this.getPlayerPositionText();
    }

    renderPlayerStageMeta(text) {
      if (this.playerElements.stageMetaHost === null) {
        return;
      }
      const meta = document.createElement("p");
      meta.className = "player-stage-meta";
      meta.textContent = text;
      this.playerElements.stageMetaHost.replaceChildren(meta);
    }

    clearPlayerStageMeta() {
      if (this.playerElements.stageMetaHost !== null) {
        this.playerElements.stageMetaHost.replaceChildren();
      }
    }

    setPlayerMainTitleText(text) {
      this.playerElements.mainTitle.classList.remove("is-logo");
      this.playerElements.mainTitle.textContent = text;
    }

    renderPlayerMainLogo() {
      const image = document.createElement("img");
      image.src = "/static/brand/blindup-dark.png";
      image.alt = "BlindUp";
      this.playerElements.mainTitle.classList.add("is-logo");
      this.playerElements.mainTitle.replaceChildren(image);
    }

    updatePlayerControls() {
      const autoEnabled = this.playerState !== null && this.playerState.auto_enabled;
      const hintsVisible = this.playerState !== null && this.playerState.hints_visible;
      this.playerElements.autoButton.textContent = `Auto: ${autoEnabled ? "on" : "off"}`;
      this.playerElements.hintsButton.textContent = `Hints: ${hintsVisible ? "shown" : "hidden"}`;
      this.playerElements.autoButton.classList.toggle("is-active", autoEnabled);
      this.playerElements.hintsButton.classList.toggle("is-active", hintsVisible);
      this.playerElements.prevButton.disabled = this.playerHistory.length === 0;
      const showStep =
        this.playerState !== null &&
        this.playerState.panel === "La la la..." &&
        this.playerState.current_round === 3;
      this.playerElements.stepButton.hidden = !showStep;
      this.playerElements.stepButton.disabled =
        !showStep ||
        this.playerState.round3_step_index >= this.getRound3Steps().length - 1;

      const showPlayPause =
        this.playerState !== null &&
        this.playerState.panel === "La la la..." &&
        this.playerTeaserSession !== null &&
        this.playerTeaserSession.status !== "finished";
      this.playerElements.playPauseButton.hidden = !showPlayPause;
      this.playerElements.playPauseButton.disabled = !showPlayPause;
      this.playerElements.playPauseButton.textContent =
        showPlayPause && this.playerTeaserSession.status === "paused" ? "Play" : "Pause";
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
          "Missing song",
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

    getSongBackground(song) {
      return (
        normalizeText(song.override_background) ||
        normalizeText(song.source.background_image) ||
        ""
      );
    }

    getSongArtwork(song) {
      return (
        normalizeText(song.override_background) ||
        normalizeText(song.source.cover_path) ||
        normalizeText(song.source.background_image) ||
        ""
      );
    }

    getSongHintCover(song) {
      return this.getSongArtwork(song);
    }

    getPlayerModeLabel() {
      return this.blindtest.game_mode === "blindup" ? "BLIND UP" : "BLIND TEST";
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
      if (this.isSlotMissing(song)) {
        this.playerTeaserSession = null;
        this.playerHintDefinitions = [];
        this.playerHintRevealCount = 0;
        this.renderPlayerHints();
        this.showPlayerError();
        this.updatePlayerControls();
        return;
      }

      const playback = this.getTeaserPlayback(song);
      this.playerHintDefinitions = this.buildPlayerHints(song);
      this.playerHintRevealCount = 0;
      this.renderPlayerHints();
      const delay = this.getPrePlayDelay();
      this.playerTeaserSession = {
        token,
        song_id: song.song_id,
        playback,
        delay_remaining_sec: delay,
        playback_elapsed_sec: 0,
        status: "playing",
        phase: delay > 0 ? "delay" : "audio",
        phase_started_at: Date.now(),
      };
      this.updatePlayerControls();
      if (delay > 0) {
        this.startCountdown(delay, token);
        this.playerPrePlayTimeout = window.setTimeout(() => {
          if (
            token !== this.playerPanelToken ||
            this.playerTeaserSession === null ||
            this.playerTeaserSession.token !== token ||
            this.playerTeaserSession.status !== "playing"
          ) {
            return;
          }
          this.beginTeaserAudioPhase();
        }, delay * 1000);
        return;
      }
      this.beginTeaserAudioPhase();
    }

    beginTeaserAudioPhase() {
      const session = this.playerTeaserSession;
      if (session === null) {
        return;
      }

      session.phase = "audio";
      session.phase_started_at = Date.now();

      const remainingDuration = Math.max(0, session.playback.duration - session.playback_elapsed_sec);
      this.startCountdown(remainingDuration, session.token);
      this.startHintTracking(session.playback.duration, session.token, session.playback_elapsed_sec);
      if (remainingDuration <= 0) {
        session.status = "finished";
        this.updatePlayerControls();
        this.handleTeaserPlaybackComplete(session.token);
        return;
      }

      if (session.playback.reverse) {
        this.playReverseSegment(
          session.song_id,
          session.playback.start,
          remainingDuration,
          session.token,
          () => {
            this.finishTeaserSession(session.token);
          }
        );
        return;
      }

      this.playNormalAudio(
        session.song_id,
        session.playback.start + session.playback_elapsed_sec,
        session.playback.start + session.playback.duration,
        session.token,
        () => {
          this.finishTeaserSession(session.token);
        }
      );
    }

    finishTeaserSession(token) {
      if (this.playerTeaserSession !== null && this.playerTeaserSession.token === token) {
        this.playerTeaserSession.playback_elapsed_sec = this.playerTeaserSession.playback.duration;
        this.playerTeaserSession.status = "finished";
        this.playerTeaserSession.phase = "finished";
      }
      this.updatePlayerControls();
      this.handleTeaserPlaybackComplete(token);
    }

    pauseTeaserSession() {
      const session = this.playerTeaserSession;
      if (session === null || session.status !== "playing") {
        return;
      }

      const elapsedSincePhaseStart = (Date.now() - session.phase_started_at) / 1000;
      if (session.phase === "delay") {
        session.delay_remaining_sec = Math.max(0, session.delay_remaining_sec - elapsedSincePhaseStart);
      } else if (session.phase === "audio") {
        session.playback_elapsed_sec = Math.min(
          session.playback.duration,
          session.playback_elapsed_sec + elapsedSincePhaseStart
        );
      }

      session.status = "paused";
      this.stopPlayerPlayback();
      this.updatePlayerControls();
    }

    resumeTeaserSession() {
      const session = this.playerTeaserSession;
      if (session === null || session.status !== "paused") {
        return;
      }

      session.status = "playing";
      session.phase_started_at = Date.now();
      if (session.phase === "delay") {
        this.startCountdown(session.delay_remaining_sec, session.token);
        this.playerPrePlayTimeout = window.setTimeout(() => {
          if (
            this.playerTeaserSession === null ||
            this.playerTeaserSession.token !== session.token ||
            this.playerTeaserSession.status !== "playing"
          ) {
            return;
          }
          this.beginTeaserAudioPhase();
        }, session.delay_remaining_sec * 1000);
      } else if (session.phase === "audio") {
        this.beginTeaserAudioPhase();
      }
      this.updatePlayerControls();
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
      const cover = this.getSongHintCover(song);
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
        this.playerElements.hints.classList.remove("has-background");
        this.playerElements.hints.hidden = true;
        this.playerElements.hints.innerHTML = "";
        return;
      }

      const hints = this.playerHintDefinitions.slice(0, this.playerHintRevealCount);
      if (hints.length === 0) {
        this.playerElements.hints.classList.remove("has-background");
        this.playerElements.hints.hidden = true;
        this.playerElements.hints.innerHTML = "";
        return;
      }

      this.playerElements.hints.hidden = false;
      this.playerElements.hints.innerHTML = "";
      const coverHint = hints.find((hint) => hint.type === "cover") || null;
      const textHints = hints.filter((hint) => hint.type !== "cover");
      const textList = document.createElement("div");
      textList.className = "player-hints-list";
      if (coverHint !== null) {
        this.playerElements.hints.classList.add("has-background");
      } else {
        this.playerElements.hints.classList.remove("has-background");
      }

      for (const hint of textHints) {
        const hintNode = document.createElement("div");
        hintNode.className = "player-hint";
        const label = document.createElement("span");
        label.className = "player-hint-label";
        label.textContent = hint.label;
        hintNode.appendChild(label);
        const value = document.createElement("div");
        appendMultilineText(value, hint.value);
        hintNode.appendChild(value);
        textList.appendChild(hintNode);
      }

      if (textHints.length > 0) {
        this.playerElements.hints.appendChild(textList);
      }

      if (coverHint !== null) {
        const coverNode = document.createElement("div");
        coverNode.className = "player-hint player-hint-background";
        const label = document.createElement("span");
        label.className = "player-hint-label";
        label.textContent = coverHint.label;
        const image = document.createElement("img");
        image.alt = coverHint.label;
        image.src = coverHint.value;
        coverNode.appendChild(label);
        coverNode.appendChild(image);
        this.playerElements.hints.appendChild(coverNode);
      }
    }

    startHintTracking(durationSec, token, initialElapsedSec = 0) {
      const startedAt = Date.now();
      if (this.playerHintInterval !== null) {
        window.clearInterval(this.playerHintInterval);
      }
      this.playerHintInterval = window.setInterval(() => {
        if (token !== this.playerPanelToken) {
          return;
        }
        const elapsedSec = Math.min(
          durationSec,
          initialElapsedSec + (Date.now() - startedAt) / 1000
        );
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
      const answer = this.ensurePlayerAnswerElements();
      this.playerElements.mainTitle.textContent = display.title;
      answer.title.textContent = display.title;
      answer.artist.textContent = display.artist || " ";
      answer.album.textContent = display.album || " ";
      answer.year.textContent = display.year || " ";
      answer.genre.textContent = display.genre || " ";
      answer.background.innerHTML = "";
      const artworkPath = this.getSongArtwork(song);
      if (artworkPath) {
        const image = document.createElement("img");
        image.src = artworkPath;
        image.alt = display.title;
        answer.background.appendChild(image);
        return;
      }
      answer.background.appendChild(
        this.createCoverThumb({ title: display.title || "Song" })
      );
    }

    ensurePlayerAnswerElements() {
      if (this.playerAnswerElements !== null) {
        return this.playerAnswerElements;
      }

      const host = this.playerElements.answerHost;
      if (host === null) {
        return {
          background: document.createElement("div"),
          title: document.createElement("dd"),
          artist: document.createElement("dd"),
          album: document.createElement("dd"),
          year: document.createElement("dd"),
          genre: document.createElement("dd"),
        };
      }

      const background = document.createElement("div");
      background.id = "player-background-tile";
      background.className = "player-background-tile";

      const row = document.createElement("div");
      row.className = "player-answer-row";
      row.appendChild(background);

      const fields = [
        ["Title", "player-answer-title", "title"],
        ["Artist", "player-answer-artist", "artist"],
        ["Album", "player-answer-album", "album"],
        ["Year", "player-answer-year", "year"],
        ["Genre", "player-answer-genre", "genre"],
      ];
      const elements = { background };
      for (const [labelText, elementId, key] of fields) {
        const item = document.createElement("div");
        item.className = "player-answer-item";
        const label = document.createElement("dt");
        label.textContent = labelText;
        const value = document.createElement("dd");
        value.id = elementId;
        item.appendChild(label);
        item.appendChild(value);
        row.appendChild(item);
        elements[key] = value;
      }

      host.replaceChildren(row);
      this.playerAnswerElements = elements;
      return this.playerAnswerElements;
    }

    clearPlayerAnswer() {
      if (this.playerElements.answerHost !== null) {
        this.playerElements.answerHost.replaceChildren();
      }
      this.playerAnswerElements = null;
    }

    startAnswerPanel(token, song) {
      if (this.playerState === null) {
        return;
      }

      if (this.isSlotMissing(song)) {
        this.showPlayerError();
      } else if (this.playerState.current_round === 1) {
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
          this.playerReverseSource.onended = null;
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
      if (app.page === "editor" && app.elements.error !== null) {
        app.showAudioError();
      } else {
        console.error(error);
      }
    }
    window.blindUpReady = true;
  });
})();
