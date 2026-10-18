using System;
using System.Linq;
using UnityEngine;
using Yunshan.Core;

namespace Yunshan.Runtime
{
    /// <summary>Procedural ambience for the native client (web src/audio/ambience.ts): filtered
    /// noise beds for wind, water, crowd and insects, sine chirps for birds and short noise
    /// bursts for steps, synthesised on the audio thread. No audio assets. Levels come from
    /// Core/Ambience.Levels, i.e. from the city's own state.</summary>
    [RequireComponent(typeof(AudioSource))]
    public sealed class AmbienceAudio : MonoBehaviour
    {
        public float Volume = .6f;
        volatile float wind, water, crowd, birds, insects, steps, rain;
        int sampleRate; uint seed = 0x9E3779B9u;
        double windLp, waterLp1, waterLp2, crowdLp1, crowdLp2, insectLp1, insectLp2, rainLp1, rainLp2;
        double chirpPhase, chirpFreq, chirpLeft, chirpWait, stepLeft, stepWait, insectPhase;
        volatile string pendingCue; Tone[] cue; double cueClock, cueEnd;

        /// <summary>A short action cue (Core/ActionCues.cs, web src/audio/cues.ts) over the ambience.</summary>
        public void Play(string name) { if (name != null && ActionCues.Tones.ContainsKey(name)) pendingCue = name; }

        double CueSample(double dt)
        {
            var next = pendingCue; if (next != null) { pendingCue = null; cue = ActionCues.Tones[next]; cueClock = 0; cueEnd = cue.Max(t => t.At + t.Duration); }
            if (cue == null) return 0;
            double sum = 0;
            foreach (var tone in cue)
            {
                double local = cueClock - tone.At; if (local < 0 || local >= tone.Duration) continue;
                // Same envelope as the web cue: 10 ms linear attack, then exponential decay to 1e-4 at the tone's end.
                double envelope = local < .01 ? tone.Gain * local / .01 : tone.Gain * Math.Exp(Math.Log(.0001 / tone.Gain) * (local - .01) / (tone.Duration - .01));
                double phase = 2 * Math.PI * tone.Frequency * local;
                sum += envelope * (tone.Wave == "sine" ? Math.Sin(phase) : 2 / Math.PI * Math.Asin(Math.Sin(phase)));
            }
            cueClock += dt; if (cueClock > cueEnd) cue = null;
            return sum;
        }

        void Awake()
        {
            sampleRate = AudioSettings.outputSampleRate;
            var source = GetComponent<AudioSource>(); source.playOnAwake = true; source.loop = true; source.spatialBlend = 0; source.Play();
        }

        public void Apply(AmbienceLevels levels)
        {
            wind = (float)levels.Wind; water = (float)levels.Water; crowd = (float)levels.Crowd;
            birds = (float)levels.Birds; insects = (float)levels.Insects; steps = (float)levels.Steps; rain = (float)levels.Rain;
        }

        float Noise() { seed ^= seed << 13; seed ^= seed >> 17; seed ^= seed << 5; return seed / (float)uint.MaxValue * 2 - 1; }
        static double Lp(ref double state, double input, double alpha) => state += alpha * (input - state);

        void OnAudioFilterRead(float[] data, int channels)
        {
            if (sampleRate <= 0) return;
            double dt = 1.0 / sampleRate, aWind = 1 - Math.Exp(-2 * Math.PI * 420 * dt), aWaterLo = 1 - Math.Exp(-2 * Math.PI * 1600 * dt), aWaterHi = 1 - Math.Exp(-2 * Math.PI * 700 * dt);
            double aCrowdLo = 1 - Math.Exp(-2 * Math.PI * 800 * dt), aCrowdHi = 1 - Math.Exp(-2 * Math.PI * 300 * dt), aInsLo = 1 - Math.Exp(-2 * Math.PI * 6000 * dt), aInsHi = 1 - Math.Exp(-2 * Math.PI * 4500 * dt);
            float gWind = wind * .18f, gWater = water * .22f, gCrowd = crowd * .2f, gIns = insects * .05f, gRain = rain * .12f, b = birds, s = steps;
            double aRainLo = 1 - Math.Exp(-2 * Math.PI * 5000 * dt), aRainHi = 1 - Math.Exp(-2 * Math.PI * 1800 * dt);
            for (int n = 0; n < data.Length; n += channels)
            {
                float w = Noise();
                double sample = Lp(ref windLp, w, aWind) * gWind * 3;
                sample += (Lp(ref waterLp1, w, aWaterLo) - Lp(ref waterLp2, w, aWaterHi)) * gWater * 4;
                sample += (Lp(ref crowdLp1, w, aCrowdLo) - Lp(ref crowdLp2, w, aCrowdHi)) * gCrowd * 5;
                sample += (Lp(ref rainLp1, w, aRainLo) - Lp(ref rainLp2, w, aRainHi)) * gRain * 4;
                insectPhase += 30 * dt; sample += (Lp(ref insectLp1, w, aInsLo) - Lp(ref insectLp2, w, aInsHi)) * gIns * 6 * (.5 + .5 * Math.Sin(2 * Math.PI * insectPhase));
                // Birds: a short rising chirp every few seconds while birds are heard.
                if (chirpLeft > 0) { chirpPhase += chirpFreq * dt; chirpFreq *= 1 + 4 * dt; sample += Math.Sin(2 * Math.PI * chirpPhase) * .05 * b * Math.Min(1, chirpLeft / .02); chirpLeft -= dt; }
                else if (b > .05 && (chirpWait -= dt) <= 0) { chirpLeft = .08; chirpFreq = 2400 + (Noise() + 1) * 900; chirpWait = 1.5 + (Noise() + 1) * 2.5 / b; }
                // Steps: a soft thump every 0.45 s while walking.
                if (stepLeft > 0) { sample += w * .25 * s * Math.Pow(stepLeft / .06, 3); stepLeft -= dt; }
                else if (s > 0 && (stepWait -= dt) <= 0) { stepLeft = .06; stepWait = .45; }
                sample += CueSample(dt);
                float v = (float)(sample * Volume);
                for (int c = 0; c < channels; c++) data[n + c] = v;
            }
        }
    }
}
