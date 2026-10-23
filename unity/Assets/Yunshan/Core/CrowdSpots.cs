using System.Collections.Generic;
using System.Linq;

namespace Yunshan.Core
{
    public struct CrowdSpot { public double X, Z; public int Count; }

    /// <summary>Port of src/rendering/crowd-spots.ts: residents who are out
    /// (not asleep, at home or dead) grouped into Cell-metre cells; the mean
    /// positions of the busiest Limit cells with at least Min people.</summary>
    public static class CrowdSpots
    {
        public const double Cell = 120; public const int Min = 5, Limit = 4;
        static readonly HashSet<string> Resting = new HashSet<string> { "sleeping", "atHome", "dead" };

        public static List<CrowdSpot> Find(IEnumerable<(double X, double Z, string State, bool Alive)> people)
        {
            var cells = new Dictionary<(long, long), int>(); var sums = new List<(double X, double Z, int Count)>();
            foreach (var p in people)
            {
                if (!p.Alive || Resting.Contains(p.State)) continue;
                var key = ((long)System.Math.Floor(p.X / Cell), (long)System.Math.Floor(p.Z / Cell));
                if (!cells.TryGetValue(key, out var index)) { index = sums.Count; cells[key] = index; sums.Add((0, 0, 0)); }
                var s = sums[index]; sums[index] = (s.X + p.X, s.Z + p.Z, s.Count + 1);
            }
            var spots = sums.Where(s => s.Count >= Min).Select(s => new CrowdSpot { X = s.X / s.Count, Z = s.Z / s.Count, Count = s.Count }).ToList();
            spots.Sort((a, b) => b.Count != a.Count ? b.Count.CompareTo(a.Count) : a.X != b.X ? a.X.CompareTo(b.X) : a.Z.CompareTo(b.Z));
            return spots.Take(Limit).ToList();
        }

        public static readonly string[] TargetKinds = { "market", "pavilion", "station", "dock", "hall", "school", "clinic", "bank" };

        /// <summary>The nearest public venue's id (any building when none).</summary>
        public static string Target(IReadOnlyList<Building> buildings, double x, double z)
        {
            double Far(Building b) => (b.Door.X - x) * (b.Door.X - x) + (b.Door.Z - z) * (b.Door.Z - z);
            Building Pick(IEnumerable<Building> list) { Building best = null; foreach (var b in list) if (best == null || Far(b) < Far(best) || Far(b) == Far(best) && string.CompareOrdinal(b.Id, best.Id) < 0) best = b; return best; }
            return (Pick(buildings.Where(b => TargetKinds.Contains(b.Kind))) ?? Pick(buildings))?.Id;
        }
    }
}
