using System.Text;
using Xunit;

namespace Yunshan.Core.Tests;

/// <summary>Replays scripts/parity/bird-flocks.ts: the flocks of the product world and the birds at seeded times.</summary>
public class BirdFlocksParityTests
{
    [Fact]
    public void BirdsMatchTypeScript()
    {
        var root = (Dictionary<string, object>)Yunshan.Core.Host.Json.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Parity", "bird-flocks.json"), Encoding.UTF8));
        var flocks = ((List<object>)root["flocks"]).Select(o => { var d = (Dictionary<string, object>)o; return new Flock { X = (double)d["x"], Y = (double)d["y"], Z = (double)d["z"], Radius = (double)d["radius"], Direction = (double)d["direction"], Phase = (double)d["phase"] }; }).ToList();
        Assert.Equal(11, flocks.Count);
        foreach (Dictionary<string, object> frame in (List<object>)root["frames"])
        {
            var want = (List<object>)frame["birds"]; var got = BirdFlocks.At(flocks, (double)frame["t"]);
            Assert.Equal(want.Count, got.Count);
            for (int i = 0; i < got.Count; i++)
            {
                var w = (Dictionary<string, object>)want[i];
                Assert.Equal((double)w["x"], got[i].X); Assert.Equal((double)w["y"], got[i].Y); Assert.Equal((double)w["z"], got[i].Z);
                Assert.Equal((double)w["yaw"], got[i].Yaw); Assert.Equal((double)w["flap"], got[i].Flap);
            }
        }
    }

    [Fact]
    public void FlocksMatchTheWorld()
    {
        var root = (Dictionary<string, object>)Yunshan.Core.Host.Json.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Parity", "district-banners.json"), Encoding.UTF8));
        Vec3 V(object o) { var d = (Dictionary<string, object>)o; return new Vec3((double)d["x"], (double)d["y"], (double)d["z"]); }
        var world = new WorldDefinition
        {
            Districts = ((List<object>)root["districts"]).Select(o => { var d = (Dictionary<string, object>)o; return new District { Id = (string)d["id"], Name = (string)d["name"], Center = V(d["center"]) }; }).ToList(),
            Buildings = ((List<object>)root["buildings"]).Select(o => { var d = (Dictionary<string, object>)o; return new Building { Id = (string)d["id"], DistrictId = (string)d["districtId"], Kind = (string)d["kind"], Position = V(d["position"]), Width = (double)d["width"], Depth = (double)d["depth"], Height = (double)d["height"], Rotation = (double)d["rotation"] }; }).ToList(),
        };
        var birds = (Dictionary<string, object>)Yunshan.Core.Host.Json.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Parity", "bird-flocks.json"), Encoding.UTF8));
        var want = (List<object>)birds["flocks"]; var got = BirdFlocks.Of(world);
        for (int i = 0; i < got.Count; i++) { var w = (Dictionary<string, object>)want[i]; Assert.Equal((double)w["y"], got[i].Y); Assert.Equal((double)w["radius"], got[i].Radius); Assert.Equal((double)w["phase"], got[i].Phase); }
    }
}
