using System.Collections.Generic;
using System.Linq;

namespace Yunshan.Core
{
    public sealed class Tone { public double Frequency, At, Duration, Gain; public string Wave; }

    /// <summary>Port of src/audio/cues.ts: short procedural action cues (no audio assets),
    /// the same tones and the same command-to-cue choice as the web client. Display only.</summary>
    public static class ActionCues
    {
        static Tone T(double frequency, double at, double duration, double gain, string wave) => new Tone { Frequency = frequency, At = at, Duration = duration, Gain = gain, Wave = wave };

        public static readonly IReadOnlyDictionary<string, Tone[]> Tones = new Dictionary<string, Tone[]>
        {
            ["ok"] = new[] { T(660, 0, .09, .05, "triangle"), T(880, .08, .12, .05, "triangle") },
            ["coin"] = new[] { T(1320, 0, .08, .04, "sine"), T(1760, .06, .16, .04, "sine") },
            ["board"] = new[] { T(523, 0, .1, .05, "triangle"), T(659, .09, .1, .05, "triangle"), T(784, .18, .16, .05, "triangle") },
            ["arrive"] = new[] { T(784, 0, .22, .05, "sine"), T(659, .2, .32, .05, "sine") },
            ["fail"] = new[] { T(196, 0, .18, .06, "triangle") },
        };

        static readonly string[] Clock = { "setTime", "pause", "speed" }, Coin = { "purchase", "deposit", "withdraw", "rent" }, Board = { "ride", "leaveVehicle", "drive", "boardAircraft", "leaveAircraft" };

        /// <summary>The cue for a command's result; null for clock controls.</summary>
        public static string CueFor(string type, bool ok)
        {
            if (Clock.Contains(type)) return null;
            if (!ok) return "fail";
            return Coin.Contains(type) ? "coin" : Board.Contains(type) ? "board" : "ok";
        }
    }
}
