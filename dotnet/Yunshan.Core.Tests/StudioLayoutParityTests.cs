using System.IO.Compression;
using System.Text;
using System.Text.Json;
using Yunshan.Core;
using Xunit;
using static Yunshan.Core.CanonicalJson;

namespace Yunshan.Core.Tests;

public class StudioLayoutParityTests
{
    public static Dictionary<string, StudioAssetBounds> Manifest()
    {
        var root = JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Parity", "studio-assets.json"))).RootElement;
        return root.GetProperty("assets").EnumerateArray().ToDictionary(a => a.GetProperty("id").GetString()!, a =>
        {
            var b = a.GetProperty("boundsM");
            return new StudioAssetBounds(a.GetProperty("id").GetString()!, b.GetProperty("min").EnumerateArray().Select(v => v.GetDouble()).ToArray(), b.GetProperty("max").EnumerateArray().Select(v => v.GetDouble()).ToArray());
        });
    }

    [Fact]
    public void PlacementsMatchTypeScript()
    {
        string expected;
        using (var file = File.OpenRead(Path.Combine(AppContext.BaseDirectory, "Parity", "studio-placements-v6.json.gz")))
        using (var gzip = new GZipStream(file, CompressionMode.Decompress))
        using (var reader = new StreamReader(gzip, Encoding.UTF8)) expected = reader.ReadToEnd();
        var assets = Manifest(); var world = World.CreateWorld(); var roads = StudioPropLayout.RoadTilePlacements(world, assets);
        var tree = new Obj()
            .Put("buildings", world.Buildings.Select(b => new Obj().Put("id", b.Id).Put("placements", StudioPropLayout.BuildingPlacements(b, assets)
                .Select(p => new Obj().Put("asset", p.Asset).Put("fixtureId", p.FixtureId).Put("floor", (double)p.Floor).Put("scale", p.Scale).Put("local", Vec(p.Local))).ToList())).ToList())
            .Put("stations", StudioPropLayout.StationPlacements(world, assets).Select(s => new Obj().Put("asset", s.Asset).Put("id", s.Id).Put("position", Vec(s.Position)).Put("yaw", s.Yaw)).ToList())
            .Put("landmarks", StudioPropLayout.LandmarkPlacements(world, assets).Select(s => new Obj().Put("asset", s.Asset).Put("id", s.Id).Put("position", Vec(s.Position)).Put("yaw", s.Yaw)).ToList())
            .Put("decks", StudioPropLayout.DeckTilePlacements(world, assets).Select(s => new Obj().Put("asset", s.Asset).Put("id", s.Id).Put("pitch", s.Pitch).Put("position", Vec(s.Position)).Put("yaw", s.Yaw)).ToList())
            .Put("roads", new Obj().Put("count", (double)roads.Count).Put("sample", roads.Where((_, i) => i % 41 == 0).Select(s => new Obj().Put("asset", s.Asset).Put("id", s.Id).Put("pitch", s.Pitch).Put("position", Vec(s.Position)).Put("yaw", s.Yaw)).ToList()));
        Assert.Equal(2, StudioPropLayout.LandmarkPlacements(world, assets).Count);
        var actual = Write(tree);
        Assert.Equal(expected.Length, actual.Length);
        Assert.True(expected == actual, "studio placements differ from TypeScript");
    }
}
