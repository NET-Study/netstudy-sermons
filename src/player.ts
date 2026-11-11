import { Sermon, durationSeconds } from "./api";

export type PlayerState = {
  sermon: Sermon | null;
  playing: boolean;
  position: number;
  duration: number;
  rate: number;
  queue: Sermon[];
  queueIndex: number;
  videoOpen: boolean;
  buffering: boolean;
};

interface Hooks {
  onChange: (state: PlayerState) => void;
  getResume: (id: string) => number;
  saveProgress: (sermon: Sermon, position: number, duration: number) => void;
  onEnded?: () => void;
}

export class Player {
  private audio: HTMLAudioElement;
  private video: HTMLVideoElement;
  private overlay: HTMLElement;
  private hooks: Hooks;
  private queue: Sermon[] = [];
  private index = -1;
  private current: Sermon | null = null;
  private rate = 1;
  private attempts = 0;
  private lastSaved = 0;
  private videoOpen = false;
  private buffering = false;

  constructor(audio: HTMLAudioElement, video: HTMLVideoElement, overlay: HTMLElement, hooks: Hooks) {
    this.audio = audio;
    this.video = video;
    this.overlay = overlay;
    this.hooks = hooks;

    for (const el of [audio, video]) {
      el.addEventListener("timeupdate", () => this.tick(el));
      el.addEventListener("loadedmetadata", () => this.tick(el));
      el.addEventListener("play", () => this.emit());
      el.addEventListener("pause", () => this.emit());
      el.addEventListener("waiting", () => {
        this.buffering = true;
        this.emit();
      });
      el.addEventListener("playing", () => {
        this.buffering = false;
        this.emit();
      });
      el.addEventListener("ended", () => this.finished(el));
      el.addEventListener("error", () => this.mediaError(el));
    }
  }

  get state(): PlayerState {
    const engine = this.engine();
    return {
      sermon: this.current,
      playing: !!this.current && !engine.paused,
      position: engine.currentTime || 0,
      duration: Number.isFinite(engine.duration) ? engine.duration : 0,
      rate: this.rate,
      queue: this.queue,
      queueIndex: this.index,
      videoOpen: this.videoOpen,
      buffering: this.buffering,
    };
  }

  get currentSermon() {
    return this.current;
  }

  private engine(): HTMLMediaElement {
    return this.videoOpen && this.current?.mp4Url ? this.video : this.audio;
  }

  private emit() {
    this.hooks.onChange(this.state);
  }

  private tick(el: HTMLMediaElement) {
    if (el !== this.engine()) return;
    if (this.current && el.duration) {
      const now = Date.now();
      if (now - this.lastSaved > 4000) {
        this.lastSaved = now;
        this.hooks.saveProgress(this.current, el.currentTime, el.duration);
      }
    }
    this.emit();
  }

  private finished(el: HTMLMediaElement) {
    if (el !== this.engine()) return;
    if (this.current) this.hooks.saveProgress(this.current, 0, el.duration || 0);
    this.next();
  }

  private sourceFor(sermon: Sermon): string[] {
    const list: string[] = [];
    if (sermon.mp3Url) list.push(sermon.mp3Url);
    if (sermon.cdnMp3Url && sermon.cdnMp3Url !== sermon.mp3Url) list.push(sermon.cdnMp3Url);
    if (sermon.archiveAudioUrl && !list.includes(sermon.archiveAudioUrl)) list.push(sermon.archiveAudioUrl);
    return list;
  }

  private videoSources(sermon: Sermon): string[] {
    const list: string[] = [];
    if (sermon.mp4Url) list.push(sermon.mp4Url);
    if (sermon.cdnMp4Url && sermon.cdnMp4Url !== sermon.mp4Url) list.push(sermon.cdnMp4Url);
    if (sermon.archiveVideoUrl && !list.includes(sermon.archiveVideoUrl)) list.push(sermon.archiveVideoUrl);
    return list;
  }

  private mediaError(el: HTMLMediaElement) {
    if (!this.current) return;
    if (el === this.video) {
      const sources = this.videoSources(this.current);
      this.attempts += 1;
      if (this.attempts < sources.length) {
        this.video.src = sources[this.attempts];
        this.video.play().catch(() => undefined);
        return;
      }
      this.closeVideo();
      return;
    }
    const sources = this.sourceFor(this.current);
    this.attempts += 1;
    if (this.attempts < sources.length) {
      const wasPlaying = !this.audio.paused;
      this.audio.src = sources[this.attempts];
      this.audio.currentTime = Math.max(0, this.audio.currentTime);
      if (wasPlaying) this.audio.play().catch(() => undefined);
    } else {
      this.buffering = false;
      this.emit();
    }
  }

  playSermon(sermon: Sermon, queue?: Sermon[]) {
    const playable = (queue ?? [sermon]).filter(
      (s) => s.mediaType !== "TEXT" && this.sourceFor(s).length + this.videoSources(s).length > 0,
    );
    const idx = playable.findIndex((s) => s.id === sermon.id);
    if (playable.length) {
      this.queue = playable;
      this.index = idx >= 0 ? idx : 0;
    } else {
      this.queue = [sermon];
      this.index = 0;
    }
    this.load(sermon);
  }

  private load(sermon: Sermon) {
    this.closeVideo(true);
    this.current = sermon;
    // Mark the sermon as started straight away so it appears in "Recently played"
    // even if the listener only hears a few seconds.
    this.hooks.saveProgress(sermon, this.hooks.getResume(sermon.id), durationSeconds(sermon.duration));
    this.attempts = 0;
    this.buffering = true;

    const sources = this.sourceFor(sermon);
    if (!sources.length) {
      // Video-only sermon: drive the player from the video element.
      this.audio.removeAttribute("src");
      this.openVideo();
      this.emit();
      return;
    }
    this.audio.src = sources[0];
    this.audio.playbackRate = this.rate;
    const resume = this.hooks.getResume(sermon.id);
    const apply = () => {
      this.audio.removeEventListener("loadedmetadata", apply);
      if (resume > 5 && resume < (this.audio.duration || 0) - 10) {
        this.audio.currentTime = resume;
      }
      this.audio.play().catch(() => {
        this.buffering = false;
        this.emit();
      });
    };
    this.audio.addEventListener("loadedmetadata", apply);
    this.emit();
  }

  toggle() {
    if (!this.current) return;
    const engine = this.engine();
    if (engine.paused) {
      engine.play().catch(() => undefined);
    } else {
      engine.pause();
    }
  }

  seekBy(seconds: number) {
    const engine = this.engine();
    if (!this.current) return;
    const duration = Number.isFinite(engine.duration) ? engine.duration : 0;
    engine.currentTime = Math.min(Math.max(0, engine.currentTime + seconds), duration || engine.currentTime + seconds);
    this.emit();
  }

  seekTo(fraction: number) {
    const engine = this.engine();
    if (!this.current || !Number.isFinite(engine.duration)) return;
    engine.currentTime = Math.max(0, Math.min(1, fraction)) * engine.duration;
    this.emit();
  }

  setRate(rate: number) {
    this.rate = rate;
    this.audio.playbackRate = rate;
    this.video.playbackRate = rate;
    this.emit();
    if (this.current) {
      const engine = this.engine();
      this.hooks.saveProgress(this.current, engine.currentTime || 0, engine.duration || 0);
    }
  }

  next() {
    if (!this.queue.length) return;
    this.index = (this.index + 1) % this.queue.length;
    this.load(this.queue[this.index]);
  }

  previous() {
    if (!this.queue.length) return;
    const engine = this.engine();
    if (engine.currentTime > 6) {
      engine.currentTime = 0;
      return;
    }
    this.index = (this.index - 1 + this.queue.length) % this.queue.length;
    this.load(this.queue[this.index]);
  }

  jumpTo(i: number) {
    if (!this.queue[i]) return;
    this.index = i;
    this.load(this.queue[i]);
  }

  openVideo() {
    if (!this.current) return;
    const sources = this.videoSources(this.current);
    if (!sources.length) return;
    const position = this.audio.currentTime || 0;
    const wasPlaying = !this.audio.paused;
    if (this.current.mp4Url || this.current.cdnMp4Url) {
      this.audio.pause();
    }
    this.videoOpen = true;
    this.attempts = 0;
    this.video.src = sources[0];
    this.overlay.classList.remove("hidden");
    this.video.currentTime = position > 0 ? position : 0;
    if (wasPlaying || this.current.mediaType === "VIDEO") this.video.play().catch(() => undefined);
    this.emit();
  }

  closeVideo(silent = false) {
    if (!this.videoOpen) return;
    const position = this.video.currentTime || 0;
    const wasPlaying = !this.video.paused;
    this.video.pause();
    this.video.removeAttribute("src");
    this.video.load();
    this.videoOpen = false;
    if (!silent) this.overlay.classList.add("hidden");
    if (this.current && this.sourceFor(this.current).length) {
      this.audio.currentTime = position;
      if (wasPlaying) this.audio.play().catch(() => undefined);
    }
    this.emit();
  }
}
