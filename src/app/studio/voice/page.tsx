'use client';

import { useEffect, useRef, useState } from 'react';
import { CircleStop, Loader2, Mic, Play, Save, Square, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, Textarea } from '@/components/ui/field';
import { Slider } from '@/components/ui/controls';
import { ChannelBadge, Panel, WorkbenchHeader } from '@/components/studio/workbench';
import { toast } from '@/components/ui/toast';
import { useAuth } from '@/lib/auth';
import { channelReady, useEndpoints } from '@/lib/endpoint-store';
import { transcribe } from '@/lib/api';
import { remember } from '@/lib/memory';
import { saveProject } from '@/lib/projects';

const BARS = 56;

export default function VoiceWorkbench() {
  const { user } = useAuth();
  const endpoints = useEndpoints((state) => state.endpoints);
  const health = useEndpoints((state) => state.health);
  const speechReady = channelReady({ endpoints, health }, 'speech');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const frameRef = useRef(0);
  const levelsRef = useRef<number[]>(new Array(BARS).fill(0));
  const startedAtRef = useRef(0);
  const chunksRef = useRef<Blob[]>([]);

  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [clip, setClip] = useState<{ url: string; blob: Blob; mime: string } | null>(null);
  const [transcript, setTranscript] = useState('');
  const [working, setWorking] = useState(false);

  const [speechText, setSpeechText] = useState('');
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceName, setVoiceName] = useState('');
  const [rate, setRate] = useState(1);
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    const paint = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const ratio = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
        canvas.width = width * ratio;
        canvas.height = height * ratio;
      }

      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const gap = 3;
      const barWidth = Math.max((width - gap * (BARS - 1)) / BARS, 1.5);
      const center = height / 2;

      levelsRef.current.forEach((level, index) => {
        const barHeight = Math.max(level * height * 0.86, 2);
        const x = index * (barWidth + gap);
        ctx.fillStyle =
          index > BARS - 14 ? 'rgba(176,122,74,0.55)' : 'rgba(58,74,99,0.42)';
        ctx.beginPath();
        const radius = barWidth / 2;
        const y = center - barHeight / 2;
        ctx.roundRect(x, y, barWidth, barHeight, radius);
        ctx.fill();
      });
    };

    paint();
    const onResize = () => paint();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const load = () => {
      const list = window.speechSynthesis?.getVoices() ?? [];
      const chinese = list.filter((voice) => /zh|cmn|Chinese/i.test(voice.lang));
      const pool = chinese.length ? chinese : list;
      setVoices(pool);
      if (!voiceName && pool[0]) setVoiceName(pool[0].name);
    };
    load();
    window.speechSynthesis?.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis?.removeEventListener('voiceschanged', load);
  }, [voiceName]);

  useEffect(
    () => () => {
      cancelAnimationFrame(frameRef.current);
      recorderRef.current?.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      audioCtxRef.current?.close().catch(() => {});
      window.speechSynthesis?.cancel();
      if (clip?.url) URL.revokeObjectURL(clip.url);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const drawLevels = (analyser: AnalyserNode) => {
    const data = new Uint8Array(analyser.fftSize);
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i += 1) {
        const value = (data[i] - 128) / 128;
        sum += value * value;
      }
      const rms = Math.sqrt(sum / data.length);
      levelsRef.current = [...levelsRef.current.slice(1), Math.min(rms * 2.6, 1)];
      setElapsed((Date.now() - startedAtRef.current) / 1000);
      frameRef.current = requestAnimationFrame(tick);
    };
    tick();
  };

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);

      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((type) =>
        typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type),
      );
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        const type = recorder.mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type });
        if (clip?.url) URL.revokeObjectURL(clip.url);
        setClip({ url: URL.createObjectURL(blob), blob, mime: type });
        stream.getTracks().forEach((track) => track.stop());
        cancelAnimationFrame(frameRef.current);
        ctx.close().catch(() => {});
      };

      startedAtRef.current = Date.now();
      setElapsed(0);
      setTranscript('');
      setRecording(true);
      recorder.start(200);
      drawLevels(analyser);
    } catch {
      toast('拿不到麦克风权限', 'error');
    }
  };

  const stop = () => {
    recorderRef.current?.stop();
    setRecording(false);
    levelsRef.current = new Array(BARS).fill(0);
  };

  const runTranscribe = async () => {
    if (!clip) return;
    if (!speechReady) {
      toast('先在设置里配置语音端点', 'error');
      return;
    }
    setWorking(true);
    try {
      const text = await transcribe({
        endpoint: endpoints.speech,
        blob: clip.blob,
        filename: clip.mime.includes('mp4') ? 'recording.mp4' : 'recording.webm',
      });
      setTranscript(text);
      toast('转写完成', 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : '转写失败', 'error');
    } finally {
      setWorking(false);
    }
  };

  const keep = async () => {
    if (!user) return;
    if (!transcript.trim()) {
      toast('先有一段文字再保存', 'error');
      return;
    }
    await saveProject({
      owner: user.id,
      kind: 'voice',
      title: transcript.slice(0, 24),
      summary: `${elapsed.toFixed(1)}s · ${transcript.slice(0, 48)}`,
      payload: { transcript, duration: elapsed },
    });
    void remember({ owner: user.id, kind: 'voice', text: transcript.slice(0, 200), tags: ['voice'] });
    toast('已存入作品库', 'success');
  };

  const speak = () => {
    if (!speechText.trim()) {
      toast('先输入要朗读的文字', 'error');
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(speechText.slice(0, 1200));
    const voice = voices.find((item) => item.name === voiceName);
    if (voice) utterance.voice = voice;
    utterance.lang = voice?.lang ?? 'zh-CN';
    utterance.rate = rate;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
  };

  return (
    <div>
      <WorkbenchHeader
        index="04"
        title="声音工坊"
        description="在本机录音并走查波形，接入语音服务后可直接转写。朗读使用浏览器自带的语音引擎，不产生网络请求。"
        actions={<ChannelBadge channel="speech" />}
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
        <Panel
          title="录音"
          hint={recording ? '正在录制' : clip ? '已有一段录音' : '点击开始'}
          action={
            <span className="font-mono text-[11px] tabular-nums text-ink/70">
              {elapsed.toFixed(1)}s
            </span>
          }
        >
          <div className="relative overflow-hidden rounded-xl bg-[rgb(var(--sunken))] px-3 py-6 shadow-[var(--shadow-inset-sm)]">
            <canvas ref={canvasRef} className="h-24 w-full" aria-hidden="true" />
            {recording ? (
              <span className="absolute left-4 top-3 flex items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-[0.2em] text-[#a24a3f]">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#a24a3f]" />
                rec
              </span>
            ) : null}
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            {recording ? (
              <Button variant="primary" size="md" onClick={stop}>
                <CircleStop size={14} />
                结束录制
              </Button>
            ) : (
              <Button variant="primary" size="md" onClick={start}>
                <Mic size={14} />
                {clip ? '重新录制' : '开始录制'}
              </Button>
            )}

            <Button variant="soft" size="md" onClick={runTranscribe} disabled={!clip || working}>
              {working ? <Loader2 size={14} className="animate-spin" /> : null}
              转写
            </Button>

            {clip ? (
              <audio src={clip.url} controls className="ml-auto h-9 max-w-[240px]" />
            ) : null}
          </div>

          {!speechReady ? (
            <p className="mt-3 text-[10.5px] leading-relaxed text-muted/70">
              转写需要语音端点（Whisper 兼容）。未配置时仍可录音，并手动补录文字。
            </p>
          ) : null}

          <div className="mt-6">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[12px] font-medium tracking-wide text-muted">文稿</span>
              <button
                type="button"
                onClick={keep}
                className="flex items-center gap-1.5 text-[11px] text-muted transition-colors hover:text-ink"
              >
                <Save size={11} />
                存入作品库
              </button>
            </div>
            <Textarea
              rows={7}
              value={transcript}
              onChange={(event) => setTranscript(event.target.value)}
              placeholder="转写结果会出现在这里，也可以直接手写。"
              className="text-[13px] leading-[1.9]"
            />
          </div>
        </Panel>

        <Panel title="朗读" hint="浏览器语音引擎">
          <Textarea
            rows={7}
            value={speechText}
            onChange={(event) => setSpeechText(event.target.value)}
            placeholder="输入要朗读的句子。"
            className="text-[13px] leading-[1.9]"
          />

          <div className="mt-4 space-y-4">
            <div>
              <div className="mb-2 text-[12px] font-medium tracking-wide text-muted">音色</div>
              <Select value={voiceName} onChange={(event) => setVoiceName(event.target.value)}>
                {voices.length === 0 ? <option value="">系统默认</option> : null}
                {voices.map((voice) => (
                  <option key={voice.name} value={voice.name}>
                    {voice.name} · {voice.lang}
                  </option>
                ))}
              </Select>
            </div>

            <Slider
              label="语速"
              min={0.6}
              max={1.6}
              step={0.05}
              value={rate}
              display={`${rate.toFixed(2)}x`}
              onChange={setRate}
            />

            <div className="flex gap-2">
              <Button variant="primary" size="md" className="flex-1" onClick={speak} disabled={speaking}>
                <Play size={13} />
                朗读
              </Button>
              <Button
                variant="soft"
                size="md"
                onClick={() => {
                  window.speechSynthesis.cancel();
                  setSpeaking(false);
                }}
                disabled={!speaking}
                aria-label="停止朗读"
              >
                <Square size={12} />
              </Button>
            </div>
          </div>

          <div className="mt-6 rounded-xl px-3 py-3 shadow-[var(--shadow-inset-sm)]">
            <div className="flex items-center gap-2 text-[11px] text-muted">
              <Volume2 size={12} />
              语音引擎由系统提供，可用音色取决于当前设备。
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
