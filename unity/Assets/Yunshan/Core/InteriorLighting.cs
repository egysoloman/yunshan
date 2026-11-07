// Port of src/rendering/interior-lighting.ts: two task lights at the occupied
// floor's real use points, dimmed by daylight through actual windows/doors and
// by city power. Read-only; never creates fixtures, power or rooms.
using System;
using System.Collections.Generic;
using System.Linq;

namespace Yunshan.Core
{
    public sealed class InteriorLight
    {
        public string AnchorId, Source, Color; public Vec3 Position;
        /// <summary>Three.js light units (as the web renderer); <see cref="Target"/> is the intended eye-level level.</summary>
        public double Intensity, Distance, Target;
    }

    public static class InteriorLighting
    {
        public const int Slots = 2;
        const double EyeHeight = 1.72;
        static double Clamp01(double v) => double.IsFinite(v) ? Math.Max(0, Math.Min(1, v)) : 0;

        public static double Attenuation(double distance, double cutoff)
        {
            if (!double.IsFinite(distance) || !double.IsFinite(cutoff) || distance < 0 || cutoff <= 0) return 0;
            double r = distance / cutoff, edge = Math.Max(0, 1 - r * r * r * r);
            return edge * edge / Math.Max(distance * distance, .01);
        }

        static double ApertureWeight(FloorPlan plan, double x, double z)
        {
            if (plan.Floor < 0) return 0;
            double weight = 0;
            foreach (var wall in plan.Walls)
            {
                double length = JsMath.Hypot(wall.B.X - wall.A.X, wall.B.Z - wall.A.Z);
                if (length <= 0) continue;
                var apertures = (wall.Windows ?? new List<WallWindow>()).Select(w => (from: w.From, to: w.To, bottom: w.Bottom, top: w.Top, t: .35)).ToList();
                if (wall.Opening != null) apertures.Add((wall.Opening.From, wall.Opening.To, 0, wall.Opening.Height, .65));
                foreach (var a in apertures)
                {
                    double t = (a.from + a.to) / 2 / length, xx = wall.A.X + (wall.B.X - wall.A.X) * t, zz = wall.A.Z + (wall.B.Z - wall.A.Z) * t;
                    double area = Math.Max(0, a.to - a.from) * Math.Max(0, a.top - a.bottom);
                    weight += a.t * area / (12 + (xx - x) * (xx - x) + (zz - z) * (zz - z));
                }
            }
            return Clamp01(weight);
        }

        static (double level, string color) Profile(Building b)
        {
            if (b.Kind == "home" || b.Kind == "farm") return (1, "#ffe4bd");
            if (b.Kind == "clinic" || b.Kind == "school" || b.Kind == "workshop") return (1.45, "#e5edf1");
            return (1.25, "#fff0d9");
        }

        public static List<InteriorLight> Configure(Building building, int floor, Vec3 camera, double daylight, double power)
        {
            var result = new List<InteriorLight>();
            if (floor < -(building.Basements ?? 0) || floor >= building.Floors) return result;
            var plan = ArchitectureFloorPlan.GetBuildingFloorPlan(building, floor); var dimensions = Access.GetFloorDimensions(building, floor);
            double floorHeight = plan != null ? plan.CeilingY - plan.Y : building.Height / building.Floors;
            double mountHeight = Math.Min(floorHeight - .6, floorHeight * .68);
            if (!double.IsFinite(mountHeight) || mountHeight <= EyeHeight) return result;
            var profile = Profile(building); double supplied = Clamp01(power), sunlight = Clamp01(daylight);
            double floorY = plan?.Y ?? floor * floorHeight;
            var anchors = new List<(string id, double x, double z, string source, Vec3 position)>();
            if (plan != null)
            {
                foreach (var point in plan.UsePoints) if (plan.Interior.Any(r => ArchitectureFloorPlan.Contains(r, point.X, point.Z)))
                    anchors.Add((point.Id, point.X, point.Z, "program-use-point", ArchitectureFloorPlan.BuildingWorldPosition(building, new Vec3(point.X, floorY + mountHeight, point.Z))));
            }
            else
            {
                for (int i = 0; i < 2; i++)
                {
                    int side = i == 0 ? -1 : 1;
                    anchors.Add(($"legacy-{i}", side * dimensions.Width * .22, 0, "preserved-legacy-placement", new Vec3(building.Position.X + side * dimensions.Width * .22, building.Position.Y + .6 + floorY + mountHeight, building.Position.Z)));
                }
            }
            anchors.Sort((a, b) => { int d = Math.Sign(JsMath.Hypot(a.position.X - camera.X, a.position.Z - camera.Z) - JsMath.Hypot(b.position.X - camera.X, b.position.Z - camera.Z)); return d != 0 ? d : string.CompareOrdinal(a.id, b.id); });
            foreach (var anchor in anchors.Take(Slots))
            {
                var rooms = plan?.Interior.Where(r => ArchitectureFloorPlan.Contains(r, anchor.x, anchor.z)).ToList();
                double localSpan = rooms != null && rooms.Count > 0 ? rooms.Min(r => JsMath.Hypot(r.X1 - r.X0, r.Z1 - r.Z0)) : JsMath.Hypot(dimensions.Width, dimensions.Depth);
                double distance = Math.Min(14, Math.Max(mountHeight * 1.8, Math.Min(localSpan, 10)));
                double access = plan != null ? ApertureWeight(plan, anchor.x, anchor.z) : 0;
                double target = profile.level * supplied * (1 - sunlight * access * .55);
                double attenuation = Attenuation(mountHeight - EyeHeight, distance);
                double intensity = attenuation > 0 ? Math.Min(70, target / attenuation) : 0;
                result.Add(new InteriorLight { AnchorId = anchor.id, Source = anchor.source, Position = anchor.position, Intensity = intensity, Distance = distance, Target = target, Color = profile.color });
            }
            return result;
        }
    }
}
