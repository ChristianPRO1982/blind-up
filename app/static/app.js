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

  function formatDuration(start, end) {
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return "--.-s";
    }

    return `${(end - start).toFixed(1)}s`;
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

      setOptions(options, emitUpdate = true) {
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

  class SongWaveformEditor {
    constructor() {
      this.elements = {
        songSelect: document.getElementById("song-select"),
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
      this.currentZoom = DEFAULT_ZOOM;
      this.pendingStart = null;
      this.selectionEnd = null;
      this.wavesurfer = null;
      this.regions = null;
      this.bindControls();
      this.showPlaceholder("No song loaded");
      this.setControlsDisabled(true);
    }

    bindControls() {
      this.elements.songSelect.addEventListener("change", () => {
        if (this.elements.songSelect.value) {
          this.loadSong(this.elements.songSelect.value);
        }
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
      const response = await fetch("/api/songs");
      const payload = await response.json();
      this.populateSongs(payload.songs || []);
    }

    populateSongs(songs) {
      this.elements.songSelect.innerHTML = "";
      if (songs.length === 0) {
        const option = document.createElement("option");
        option.textContent = "No songs available";
        this.elements.songSelect.appendChild(option);
        this.elements.songSelect.disabled = true;
        return;
      }

      for (const song of songs) {
        const option = document.createElement("option");
        const title = song.title || `Song ${song.id}`;
        option.value = song.id;
        option.textContent = song.artist ? `${title} — ${song.artist}` : title;
        this.elements.songSelect.appendChild(option);
      }
      this.elements.songSelect.disabled = false;
      this.loadSong(this.elements.songSelect.value);
    }

    loadSong(songId) {
      this.destroyWaveform();
      this.pendingStart = null;
      this.selectionEnd = null;
      this.currentZoom = DEFAULT_ZOOM;
      this.hideError();
      this.updateDisplays();
      this.showPlaceholder("Loading audio...");

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
        this.setControlsDisabled(false);
        this.updateDisplays();
        this.updateMarkLabel();
      });
      this.wavesurfer.on("error", () => this.showAudioError());
      this.setControlsDisabled(true);
      this.wavesurfer.load(`/api/audio/${songId}`);
    }

    destroyWaveform() {
      if (this.wavesurfer !== null) {
        this.wavesurfer.destroy();
      }
      this.wavesurfer = null;
      this.regions = null;
    }

    setZoom(value) {
      this.currentZoom = Math.max(MIN_ZOOM, value);
      if (this.wavesurfer !== null) {
        this.wavesurfer.zoom(this.currentZoom);
      }
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
      const end = duration > 0 ? Math.min(duration, this.pendingStart + MIN_REGION_SPAN) : this.pendingStart + MIN_REGION_SPAN;
      this.regions.addRegion({
        start: this.pendingStart,
        end,
        drag: true,
        resize: false,
        pending: true,
      });
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
      this.updateDisplays();
      this.updateMarkLabel();
    }

    syncSelectionFromRegion(region) {
      this.pendingStart = region.start;
      this.selectionEnd = region.pending ? null : region.end;
      this.updateDisplays();
      this.updateMarkLabel();
    }

    resetSelection() {
      this.pendingStart = null;
      this.selectionEnd = null;
      if (this.regions !== null) {
        this.regions.clearRegions();
      }
      this.updateDisplays();
      this.updateMarkLabel();
    }

    showPlaceholder(message) {
      this.elements.waveform.innerHTML = `<div class="waveform-empty">${message}</div>`;
    }

    showAudioError() {
      this.elements.error.hidden = false;
      this.showPlaceholder("Audio unavailable");
      this.setControlsDisabled(true);
    }

    hideError() {
      this.elements.error.hidden = true;
    }

    setControlsDisabled(disabled) {
      this.elements.playPause.disabled = disabled;
      this.elements.zoomOut.disabled = disabled;
      this.elements.zoomIn.disabled = disabled;
      this.elements.zoomReset.disabled = disabled;
      this.elements.mark.disabled = disabled;
      this.elements.reset.disabled = disabled;
    }

    updateDisplays() {
      const current = this.wavesurfer ? this.wavesurfer.getCurrentTime() : 0;
      this.elements.currentTime.textContent = formatTime(current);
      this.elements.startTime.textContent = formatTime(this.pendingStart);
      this.elements.endTime.textContent = formatTime(this.selectionEnd);
      this.elements.duration.textContent = formatDuration(this.pendingStart, this.selectionEnd);
    }

    updateMarkLabel() {
      let label = "Mark → Start";

      if (this.pendingStart !== null) {
        label = "Mark → End";
      }

      if (
        this.wavesurfer !== null &&
        this.pendingStart !== null &&
        this.selectionEnd !== null &&
        this.selectionEnd > this.pendingStart
      ) {
        const current = this.wavesurfer.getCurrentTime();
        if (current < this.pendingStart) {
          label = "Mark → Start";
        } else if (current > this.selectionEnd) {
          label = "Mark → End";
        } else {
          const relative =
            (current - this.pendingStart) / (this.selectionEnd - this.pendingStart);
          label = relative <= 0.25 ? "Mark → Start" : "Mark → End";
        }
      }

      this.elements.mark.textContent = label;
    }
  }

  document.addEventListener("DOMContentLoaded", async () => {
    const editor = new SongWaveformEditor();
    try {
      await editor.init();
    } catch (error) {
      editor.showAudioError();
    }
    window.blindUpReady = true;
  });
})();
