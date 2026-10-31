using System;
using System.Collections.Generic;

namespace Yunshan.Core
{
    /// <summary>Port of src/entrance-hint.ts: when E finds nothing to use, the nearest entrance within
    /// HintMetres and where it lies relative to the way the player faces (display only).</summary>
    public static class EntranceHint
    {
        public const double HintMetres = 80;
        static readonly string[] Sides = { "正前方", "右前方", "右侧", "右后方", "身后", "左后方", "左侧", "左前方" };
        static double JsRound(double v) => Math.Floor(v + .5);

        /// <summary><paramref name="forwardX"/>/<paramref name="forwardZ"/> is the horizontal facing direction in game coordinates.</summary>
        public static string Hint(Vec3 position, double forwardX, double forwardZ, IEnumerable<Building> buildings)
        {
            Building best = null; double bestMetres = 0, bdx = 0, bdz = 0;
            foreach (var b in buildings)
            {
                double dx = b.Door.X - position.X, dz = b.Door.Z - position.Z, metres = Math.Sqrt(dx * dx + dz * dz);
                if (metres <= HintMetres && Math.Abs(b.Door.Y - position.Y) < 12 && (best == null || metres < bestMetres || metres == bestMetres && string.CompareOrdinal(b.Name, best.Name) < 0)) { best = b; bestMetres = metres; bdx = dx; bdz = dz; }
            }
            if (best == null) return null;
            double length = Math.Sqrt(forwardX * forwardX + forwardZ * forwardZ); if (length == 0) length = 1;
            double fx = forwardX / length, fz = forwardZ / length, ahead = bdx * fx + bdz * fz, right = bdx * -fz + bdz * fx;
            double bearing = Math.Atan2(right, ahead) * 180 / Math.PI;
            int index = (int)(((JsRound(bearing / 45) % 8) + 8) % 8);
            return $"最近的入口：{best.Name}，在你{Sides[index]}约 {Math.Max(1, JsRound(bestMetres))} 米。";
        }
    }
}
