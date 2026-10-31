using System;

namespace Yunshan.Core
{
    /// <summary>Port of src/audio/ambience.ts (ambienceLevels, daylight): the levels of the
    /// procedural ambience, read from the city's own state. Parity-tested.</summary>
    public sealed class AmbienceInput
    {
        public double Hour, Ground, WaterDistance, WalkingSpeed; public Vec3 Position; public int NearbyPeople; public bool Inside, Paused; public string Weather = "晴";
    }
    public sealed class AmbienceLevels { public double Wind, Water, Crowd, Birds, Insects, Steps, Rain; }

    public static class Ambience
    {
        static double Clamp01(double v) => Math.Max(0, Math.Min(1, v));

        /// <summary>0 at night, 1 by day, eased over dawn (5–7) and dusk (18–20).</summary>
        public static double Daylight(double hour)
        {
            double h = ((hour % 24) + 24) % 24;
            return h < 5 || h >= 20 ? 0 : h < 7 ? (h - 5) / 2 : h < 18 ? 1 : (20 - h) / 2;
        }

        public static AmbienceLevels Levels(AmbienceInput i)
        {
            double day = Daylight(i.Hour); bool indoor = i.Inside, rain = i.Weather == "雨";
            double crowd = Clamp01(i.NearbyPeople / 12.0) * (indoor ? .5 : 1) * .7;
            return new AmbienceLevels
            {
                Wind = Clamp01(.12 + Math.Max(0, i.Position.Y - i.Ground) / 150 * .5 + (rain ? .2 : 0)) * (indoor ? .25 : 1),
                Water = Clamp01(1 - i.WaterDistance / 120) * (indoor ? .2 : 1) * .8,
                Crowd = crowd,
                Birds = indoor ? 0 : day * (1 - crowd) * .35 * (rain ? .2 : 1),
                Insects = indoor ? 0 : (1 - day) * .3 * (rain ? .3 : 1),
                Steps = i.Paused || i.WalkingSpeed < .5 ? 0 : Clamp01(i.WalkingSpeed / 6) * .5,
                Rain = rain ? (indoor ? .25 : .8) : 0,
            };
        }
    }
}
