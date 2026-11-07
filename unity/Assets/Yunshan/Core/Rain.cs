namespace Yunshan.Core
{
    /// <summary>Port of src/rendering/rain.ts: display-only rain streaks on a world-anchored
    /// lattice that wraps around the camera. The same integer hash and arithmetic order, so a
    /// streak's top is bit-identical to the web (parity fixture rain.json).</summary>
    public static class Rain
    {
        public const int Count = 2400;
        public const double Half = 36, Height = 24, Below = 6, Fall = 9, Length = 1.6, SlantX = .12, SlantZ = .05;

        static double Unit(int i, int salt)
        {
            unchecked
            {
                uint h = (uint)(i + 1) * 0x9e3779b1u ^ (uint)salt * 0x85ebca6bu;
                h = (h ^ (h >> 15)) * 0x2c1b3c6du; h ^= h >> 12;
                return h / 4294967296.0;
            }
        }
        static double Wrap(double v, double span) => ((v % span) + span) % span;

        public static bool Active(string weather, bool inside) => weather == "雨" && !inside;

        /// <summary>The top of streak i at render time <paramref name="elapsed"/> (seconds) around the camera.</summary>
        public static Vec3 Drop(int i, double elapsed, Vec3 camera)
        {
            double span = Half * 2, drop = Wrap(Unit(i, 3) * Height + elapsed * Fall, Height);
            double x = Unit(i, 1) * span + drop * SlantX, z = Unit(i, 2) * span + drop * SlantZ;
            return new Vec3(camera.X - Half + Wrap(x - camera.X + Half, span), camera.Y + Height - Below - drop, camera.Z - Half + Wrap(z - camera.Z + Half, span));
        }
    }
}
