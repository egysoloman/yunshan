// Port of src/rendering/district-banners.ts: tall cloth hangings with the district's name on the
// entrance facades of the tallest-enough buildings nearest each district's centre. Display only.
using System.Collections.Generic;
using System.Linq;

namespace Yunshan.Core
{
    public sealed class DistrictBanner { public string DistrictId, BuildingId, Text; public double X, Y, Z, Yaw; }

    public static class DistrictBanners
    {
        public const double Width = 1.4, Height = 6, Bottom = 4.6, Out = .6, Inset = 2.5; public const int PerDistrict = 6;
        public static readonly string[] Skip = { "pavilion", "core" };

        public static List<DistrictBanner> Of(WorldDefinition world)
        {
            var output = new List<DistrictBanner>();
            foreach (var district in world.Districts)
            {
                var centre = district.Center;
                var chosen = world.Buildings
                    .Where(b => b.DistrictId == district.Id && !Skip.Contains(b.Kind) && b.Height >= Bottom + Height + 1 && b.Width >= Inset * 2 + Width * 2)
                    .Select(b => (b, d: JsMath.Hypot(b.Position.X - centre.X, b.Position.Z - centre.Z)))
                    .OrderBy(p => p.d).ThenBy(p => p.b.Id, System.StringComparer.Ordinal).Take(PerDistrict).ToList();
                for (int i = 0; i < chosen.Count; i++)
                {
                    var b = chosen[i].b;
                    double lx = (i % 2 == 1 ? 1 : -1) * (b.Width / 2 - Inset - Width / 2), lz = b.Depth / 2 + Out, c = JsMath.Cos(b.Rotation), s = JsMath.Sin(b.Rotation);
                    output.Add(new DistrictBanner { DistrictId = district.Id, BuildingId = b.Id, Text = district.Name, Yaw = b.Rotation,
                        X = b.Position.X + lx * c + lz * s, Y = b.Position.Y + .6 + Bottom + Height / 2, Z = b.Position.Z - lx * s + lz * c });
                }
            }
            return output;
        }
    }
}
