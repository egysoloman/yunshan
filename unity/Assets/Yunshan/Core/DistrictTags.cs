// Port of src/rendering/district-tags.ts: while flying, each district's name hangs as a vertical tag
// of constant screen size above its tallest roof at its centre. Display only.
namespace Yunshan.Core
{
    public sealed class DistrictTag { public string DistrictId, Text; public double X, Y, Z; }

    public static class DistrictTags
    {
        public const double Lift = 50, Near = 220, Screen = .16;

        public static System.Collections.Generic.List<DistrictTag> Of(WorldDefinition world)
        {
            var output = new System.Collections.Generic.List<DistrictTag>();
            foreach (var d in world.Districts)
            {
                double top = d.Center.Y;
                foreach (var b in world.Buildings) if (b.DistrictId == d.Id) top = JsMath.Max(top, b.Position.Y + .6 + b.Height);
                output.Add(new DistrictTag { DistrictId = d.Id, Text = d.Name, X = d.Center.X, Y = top + Lift, Z = d.Center.Z });
            }
            return output;
        }

        public static bool Shown(bool flying, DistrictTag tag, Vec3 camera) => flying && JsMath.Hypot(tag.X - camera.X, tag.Y - camera.Y, tag.Z - camera.Z) > Near;
    }
}
