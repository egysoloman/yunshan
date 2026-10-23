using System.Text;
using Xunit;

namespace Yunshan.Core.Tests;

/// <summary>Replays scripts/parity/district-banners.ts on the product world's districts and buildings.</summary>
public class DistrictBannersParityTests
{
    [Fact]
    public void BannersAndTagsMatchTypeScript()
    {
        var root = (Dictionary<string, object>)Yunshan.Core.Host.Json.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Parity", "district-banners.json"), Encoding.UTF8));
        Vec3 V(object o) { var d = (Dictionary<string, object>)o; return new Vec3((double)d["x"], (double)d["y"], (double)d["z"]); }
        var world = new WorldDefinition
        {
            Districts = ((List<object>)root["districts"]).Select(o => { var d = (Dictionary<string, object>)o; return new District { Id = (string)d["id"], Name = (string)d["name"], Center = V(d["center"]) }; }).ToList(),
            Buildings = ((List<object>)root["buildings"]).Select(o => { var d = (Dictionary<string, object>)o; return new Building { Id = (string)d["id"], DistrictId = (string)d["districtId"], Kind = (string)d["kind"], Position = V(d["position"]),
                Width = (double)d["width"], Depth = (double)d["depth"], Height = (double)d["height"], Rotation = (double)d["rotation"] }; }).ToList(),
        };
        var want = (List<object>)root["banners"]; var got = DistrictBanners.Of(world);
        Assert.Equal(66, want.Count); Assert.Equal(want.Count, got.Count);
        for (int i = 0; i < got.Count; i++)
        {
            var row = (Dictionary<string, object>)want[i]; var p = V(row["position"]);
            Assert.Equal((string)row["districtId"], got[i].DistrictId); Assert.Equal((string)row["buildingId"], got[i].BuildingId); Assert.Equal((string)row["text"], got[i].Text);
            Assert.Equal(p.X, got[i].X); Assert.Equal(p.Y, got[i].Y); Assert.Equal(p.Z, got[i].Z); Assert.Equal((double)row["yaw"], got[i].Yaw);
        }
        var wantTags = (List<object>)root["tags"]; var tags = DistrictTags.Of(world);
        Assert.Equal(11, wantTags.Count); Assert.Equal(wantTags.Count, tags.Count);
        for (int i = 0; i < tags.Count; i++)
        {
            var row = (Dictionary<string, object>)wantTags[i]; var p = V(row["position"]);
            Assert.Equal((string)row["districtId"], tags[i].DistrictId); Assert.Equal((string)row["text"], tags[i].Text);
            Assert.Equal(p.X, tags[i].X); Assert.Equal(p.Y, tags[i].Y); Assert.Equal(p.Z, tags[i].Z);
        }
        Assert.False(DistrictTags.Shown(false, tags[0], new Vec3(0, 5000, 0)));
        Assert.True(DistrictTags.Shown(true, tags[0], new Vec3(tags[0].X, tags[0].Y, tags[0].Z + 221)));
        Assert.False(DistrictTags.Shown(true, tags[0], new Vec3(tags[0].X, tags[0].Y, tags[0].Z + 219)));
    }
}
