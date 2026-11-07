using System.IO.Compression;
using System.Text;
using Xunit;
using static Yunshan.Core.CanonicalJson;

namespace Yunshan.Core.Tests;

/// <summary>Replays scripts/parity/walker.ts: streets, doors, rooms and stairs.</summary>
public class PlayerWalkerParityTests
{
    [Fact]
    public void WalkingMatchesTheWebController()
    {
        string expected;
        using (var file = File.OpenRead(Path.Combine(AppContext.BaseDirectory, "Parity", "walker-v6.json.gz")))
        using (var gzip = new GZipStream(file, CompressionMode.Decompress))
        using (var reader = new StreamReader(gzip, Encoding.UTF8)) expected = reader.ReadToEnd();
        var world = World.CreateWorld();
        var walker = new PlayerWalker(world, (b, f) => Access.CanAccessFloor(b, f, "traveler", new[] { "traveler" }));
        var log = new List<object>();
        void Record(string label)
        {
            var o = new Obj().Put("label", label).Put("feet", Vec(walker.Feet)).Put("floor", (double)walker.Floor).Put("yaw", walker.Yaw);
            o["inside"] = walker.Inside?.Id; o["blocked"] = walker.BlockedAccess;
            log.Add(o);
        }
        void WalkTo(double x, double z, bool sprint, int limit)
        {
            for (int i = 0; i < limit; i++)
            {
                var f = walker.Feet; double dx = x - f.X, dz = z - f.Z;
                if (JsMath.Hypot(dx, dz) < 1.2) break;
                walker.Yaw = JsMath.Atan2(-dx, -dz);
                walker.Step(1d / 30, 1, 0, sprint, false);
                if (i % 15 == 0) Record($"walk {i}");
            }
            Record("arrived");
        }
        List<Building> Nearest(string kind, int count)
        {
            var list = world.Buildings.Where(b => b.Kind == kind).ToList();
            Js.StableSort(list, (a, b) => Js.Or(JsMath.Hypot(a.Door.X - world.Spawn.X, a.Door.Z - world.Spawn.Z) - JsMath.Hypot(b.Door.X - world.Spawn.X, b.Door.Z - world.Spawn.Z), () => string.CompareOrdinal(a.Id, b.Id) < 0 ? -1 : 1));
            return list.Take(count).ToList();
        }
        var targets = Nearest("market", 2).Concat(Nearest("home", 3)).Concat(Nearest("school", 1)).ToList();
        for (int index = 0; index < targets.Count; index++)
        {
            var building = targets[index];
            WalkTo(building.Door.X, building.Door.Z, index % 2 == 0, 2400);
            Record($"street {building.Id}");
            bool profiled = ArchitectureFloorPlan.GetBuildingBody(building) != null;
            Vec3 outside;
            if (profiled) { var local = ArchitectureFloorPlan.BuildingLocalPosition(building, ArchitectureFloorPlan.GetBuildingEntrance(building)); outside = ArchitectureFloorPlan.BuildingWorldPosition(building, new Vec3(local.X, local.Y, local.Z + 4)); }
            else outside = new Vec3(building.Door.X, building.Door.Y, building.Door.Z + 4);
            walker.SetWalk(new Vec3(outside.X, World.GetWalkHeight(world, outside.X, outside.Z, outside.Y), outside.Z));
            Record($"placed {building.Id}");
            WalkTo(building.Door.X, building.Door.Z, false, 600);
            Record($"door {building.Id} {(walker.UseDoor(building) ? "true" : "false")}");
            if (walker.Inside != null)
            {
                var stair = Access.GetStairPosition(building, walker.Floor);
                WalkTo(stair.X, stair.Z, false, 900);
                Record($"stairs {(walker.UseStairs() ? "true" : "false")}");
                var up = Access.GetStairPosition(building, walker.Floor);
                WalkTo(up.X + 2, up.Z + 2, false, 300);
                Record($"stairs {(walker.UseStairs() ? "true" : "false")}");
                WalkTo(building.Door.X, building.Door.Z, false, 900);
                Record($"out {(walker.UseDoor(building) ? "true" : "false")}");
            }
            Record($"profiled {(profiled ? "true" : "false")}");
        }
        var actual = Write(log);
        if (expected != actual)
        {
            int at = 0; while (at < Math.Min(expected.Length, actual.Length) && expected[at] == actual[at]) at++;
            Assert.Fail($"walker differs at {at}: expected …{expected.Substring(Math.Max(0, at - 200), Math.Min(400, expected.Length - Math.Max(0, at - 200)))}… actual …{actual.Substring(Math.Max(0, at - 200), Math.Min(400, actual.Length - Math.Max(0, at - 200)))}…");
        }
    }
}
