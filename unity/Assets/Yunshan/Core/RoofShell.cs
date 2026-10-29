using System;
using System.Collections.Generic;
using System.Linq;

namespace Yunshan.Core
{
    /// <summary>Lower eave ring (重檐) of a hall: a hip profile with the walls' footprint cut out.</summary>
    public sealed class RoofSkirt { public double Width, Depth, Rise; public Vec3 Position; public int Floor; public double[] Hole; }

    /// <summary>One pitched roof over a program body's top (display only).</summary>
    public sealed class RoofShellSpec { public string Form, Color; public double Width, Depth, Rise; public Vec3 Position; public int Floor; public RoofSkirt Skirt; }

    /// <summary>Port of programRoofShell and roofHeightAt (src/renderer.ts,
    /// src/rendering/architecture-layout.ts): a hip roof on halls, an
    /// overhanging gable on everyday buildings, both in the building's local frame.</summary>
    public static class RoofShell
    {
        static readonly HashSet<string> HipKinds = new HashSet<string> { "school", "hall", "clinic", "bank", "police", "temple" };
        static readonly HashSet<string> BareKinds = new HashSet<string> { "station", "airport", "starport", "core", "pavilion" };

        /// <summary>How far an eave corner curls up, as a share of the roof's rise.</summary>
        public const double CornerLift = .32;

        /// <summary>Normalized profile height (0 eave … 1 ridge) at x, z ∈ [-.5, .5].</summary>
        public static double HeightAt(string form, double x, double z)
        {
            double radius = form == "gable" ? Math.Abs(x * 2) : Math.Max(Math.Abs(z * 2), Math.Max(0, (Math.Abs(x * 2) - .46) / .54));
            double slope = Math.Max(0, Math.Min(1, (radius - .12) / .88));
            // 翼角 (architecture-layout.ts ROOF_CORNER_LIFT): the eave corners curl up.
            double Edge(double v) { double t = Math.Max(0, Math.Min(1, (Math.Abs(v * 2) - .62) / .38)); return t * t * (3 - 2 * t); }
            return 1 - Math.Pow(slope, .67) + .04 * Math.Pow(slope, 8) + CornerLift * Edge(x) * Edge(z);
        }

        public static RoofShellSpec Of(Building b, IEnumerable<RoofRegion> regions)
        {
            if (BareKinds.Contains(b.Kind) || b.Id == "core-main" || b.Facility != null || b.Floors > 7) return null;
            // Same arithmetic as the web's roof parts (centre ± half size).
            var roofs = regions.Select(r => (r, cx: (r.Rect.X0 + r.Rect.X1) / 2, cy: (r.Bottom + r.Top) / 2, cz: (r.Rect.Z0 + r.Rect.Z1) / 2, sx: r.Rect.X1 - r.Rect.X0, sy: r.Top - r.Bottom, sz: r.Rect.Z1 - r.Rect.Z0)).ToList();
            if (roofs.Count == 0) return null;
            double top = roofs.Max(p => p.cy + p.sy / 2);
            var highest = roofs.Where(p => p.cy + p.sy / 2 > top - .6).ToList();
            int floor = highest.Max(p => p.r.Floor);
            if (b.FloorUses != null && floor >= 0 && floor < b.FloorUses.Count && b.FloorUses[floor] != null && b.FloorUses[floor].Contains("观景")) return null;
            double x0 = double.PositiveInfinity, x1 = double.NegativeInfinity, z0 = double.PositiveInfinity, z1 = double.NegativeInfinity, area = 0;
            foreach (var p in highest) { x0 = Math.Min(x0, p.cx - p.sx / 2); x1 = Math.Max(x1, p.cx + p.sx / 2); z0 = Math.Min(z0, p.cz - p.sz / 2); z1 = Math.Max(z1, p.cz + p.sz / 2); area += p.sx * p.sz; }
            double w = x1 - x0, d = z1 - z0;
            if (!(w > 2 && d > 2) || area / (w * d) < .7) return null;
            double overhang = Math.Min(3, Math.Max(.8, Math.Min(w, d) * .08)), rise = Math.Min(11, Math.Max(1.8, Math.Min(w, d) * .4));
            bool hip = HipKinds.Contains(b.Kind);
            var centre = new Vec3((x0 + x1) / 2, top, (z0 + z1) / 2); double storey = b.Height / Math.Max(1, b.Floors);
            RoofSkirt skirt = null;
            if (hip && floor >= 1 && top - storey > 2.5)
            {
                double reach = overhang * 2.2, W = w + reach * 2, D = d + reach * 2, ringRise = Math.Min(4, Math.Max(1.2, reach * .9));
                double inner = Math.Min(HeightAt("hip", w / 2 / W, 0), HeightAt("hip", 0, d / 2 / D)), eave = HeightAt("hip", 0, .5), scale = ringRise / Math.Max(.05, inner - eave);
                skirt = new RoofSkirt { Width = W, Depth = D, Rise = scale, Position = new Vec3(centre.X, top - storey + .3 - scale * inner, centre.Z), Floor = Math.Max(0, floor - 1), Hole = new[] { -w / 2 / W, w / 2 / W, -d / 2 / D, d / 2 / D } };
            }
            return new RoofShellSpec { Form = hip ? "hip" : "gable", Width = w + overhang * 2, Depth = d + overhang * 2, Rise = rise, Color = hip ? "#477f69" : "#4f8a72", Position = centre, Floor = Math.Max(0, floor), Skirt = skirt };
        }

        /// <summary>The simple (far-proxy) grid of createRoofGeometry: column and row
        /// cuts in normalized space, and whether a cell lies outside the hole.</summary>
        public static (List<double> Xs, List<double> Zs) Grid(string form, double[] hole)
        {
            List<double> Cuts(double? a, double? b)
            {
                var set = new List<double> { -.5, 0, .5 };
                foreach (var v in new[] { a, b }) if (v.HasValue && v.Value > -.5 && v.Value < .5) set.Add(v.Value);
                return set.Distinct().OrderBy(v => v).ToList();
            }
            var xs = Cuts(hole?[0], hole?[1]); if (form == "hip") { xs.Add(-.23); xs.Add(.23); xs = xs.Distinct().OrderBy(v => v).ToList(); }
            return (xs, Cuts(hole?[2], hole?[3]));
        }
    }
}
