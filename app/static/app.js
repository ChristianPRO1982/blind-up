(function () {
  const DEFAULT_ZOOM = 40;
  const ZOOM_STEP = 30;
  const MIN_ZOOM = 10;
  const MIN_REGION_SPAN = 0.1;

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
            startX: event.clientX,
            initialStart: this.start,
            initialEnd: this.end,
          };
          this.element.classList.add("is-dragging");
          document.addEventListener("pointermove", this.handlePointerMove);
          document.addEventListener("pointerup", this.handlePointerUp);
        });
      }

      handlePointerMove(event) {
        if (this.pointerState === null) {
          return;
        }

        const track = this.plugin.wavesurfer.getTrackElement();
        const duration = this.plugin.wavesurfer.getDuration();
        const pixelsPerSecond = track.getBoundingClientRect().width / duration;
        const deltaSec = (event.clientX - this.pointerState.startX) / pixelsPerSecond;

        if (this.pointerState.mode === "move") {
          const span = this.pointerState.initialEnd - this.pointerState.initialStart;
          this.setOptions(
            {
              start: this.pointerState.initialStart + deltaSec,
              end: this.pointerState.initialStart + deltaSec + span,
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

  class BlindtestEditorApp {
    constructor() {
      this.elements = {
        title: document.getElementById("blindtest-title"),
        saveButton: document.getElementById("save-button"),
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
      this.bindForm();
      this.showEditorEmpty();
      this.setWaveformControlsDisabled(true);
      this.showPlaceholder("Select a song card");
    }

    createDefaultBlindtest() {
      return {
        id: null,
        title: "",
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
        return [
          song.title,
          song.artist,
          song.album,
          song.year,
        ]
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
        const details = [
          normalizeText(song.album),
          song.year === null || song.year === undefined ? "" : String(song.year),
        ]
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
      let label = "Mark";

      if (this.pendingStart === null) {
        this.elements.mark.textContent = label;
        return;
      }

      if (this.selectionEnd === null || this.wavesurfer === null) {
        this.elements.mark.textContent = label;
        return;
      }

      const current = this.wavesurfer.getCurrentTime();
      if (current < this.pendingStart) {
        label = "Mark";
      } else if (current > this.selectionEnd) {
        label = "Mark";
      } else {
        const relative = (current - this.pendingStart) / (this.selectionEnd - this.pendingStart);
        label = relative <= 0.25 ? "Mark" : "Mark";
      }

      this.elements.mark.textContent = label;
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
    const editor = new BlindtestEditorApp();
    try {
      await editor.init();
    } catch (error) {
      editor.showAudioError();
    }
    window.blindUpReady = true;
  });
})();
