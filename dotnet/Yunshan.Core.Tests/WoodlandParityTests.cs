using System.IO.Compression;
using System.Text;
using Xunit;
using static Yunshan.Core.CanonicalJson;

namespace Yunshan.Core.Tests;

/// <summary>Replays scripts/parity/woodland.ts: every tree and shrub position, species, model, height and yaw.</summary>
public class WoodlandParityTests
{
    [Fact]
    public void WoodlandMatchesTypeScript()
    {
        string expected;
        using (var file = File.OpenRead(Path.Combine(AppContext.BaseDirectory, "Parity", "woodland-v6.json.gz")))
        using (var gzip = new GZipStream(file, CompressionMode.Decompress))
        using (var reader = new StreamReader(gzip, Encoding.UTF8)) expected = reader.ReadToEnd();
        var layout = WoodlandLayout.Layout(World.CreateWorld());
        Assert.Equal(5200, layout.Trees.Count);
        var tree = new Obj()
            .Put("trees", layout.Trees.Select(t => new Obj().Put("id", (double)t.Id).Put("asset", t.Asset).Put("species", (double)t.Species).Put("x", t.X).Put("y", t.Y).Put("z", t.Z).Put("height", t.Height).Put("yaw", t.Yaw)).ToList())
            .Put("shrubs", layout.Shrubs.Select(s => new Obj().Put("id", (double)s.Id).Put("asset", s.Asset).Put("x", s.X).Put("y", s.Y).Put("z", s.Z).Put("yaw", s.Yaw)).ToList())
            .Put("stands", (double)layout.Stands);
        var actual = Write(tree);
        if (expected != actual)
        {
            int i = 0; while (i < Math.Min(expected.Length, actual.Length) && expected[i] == actual[i]) i++;
            Assert.Fail($"woodland differs at {i}: expected …{expected.Substring(Math.Max(0, i - 80), Math.Min(160, expected.Length - Math.Max(0, i - 80)))}… actual …{actual.Substring(Math.Max(0, i - 80), Math.Min(160, actual.Length - Math.Max(0, i - 80)))}…");
        }
    }
}

public class RiverDressingParityTests
{
    [Fact]
    public void RiverDressingMatchesTypeScript()
    {
        string expected;
        using (var file = File.OpenRead(Path.Combine(AppContext.BaseDirectory, "Parity", "river-dressing-v6.json.gz")))
        using (var gzip = new GZipStream(file, CompressionMode.Decompress))
        using (var reader = new StreamReader(gzip, Encoding.UTF8)) expected = reader.ReadToEnd();
        var d = WoodlandLayout.RiverDressing(World.CreateWorld());
        object Rows(List<WoodlandLayout.Block> blocks) => blocks.Select(b => (object)new Obj().Put("x", b.X).Put("y", b.Y).Put("z", b.Z).Put("w", b.W).Put("h", b.H).Put("d", b.D)).ToList();
        var actual = Write(new Obj().Put("stones", Rows(d.Stones)).Put("reeds", Rows(d.Reeds)).Put("foam", Rows(d.Foam)));
        Assert.Equal(712, d.Stones.Count); Assert.Equal(700, d.Reeds.Count); Assert.Equal(80, d.Foam.Count);
        Assert.True(expected == actual, "river dressing differs from TypeScript");
    }
}

public class GroundDressingParityTests
{
    [Fact]
    public void GroundDressingMatchesTypeScript()
    {
        string expected;
        using (var file = File.OpenRead(Path.Combine(AppContext.BaseDirectory, "Parity", "ground-dressing-v6.json.gz")))
        using (var gzip = new GZipStream(file, CompressionMode.Decompress))
        using (var reader = new StreamReader(gzip, Encoding.UTF8)) expected = reader.ReadToEnd();
        var world = World.CreateWorld();
        var items = WoodlandLayout.GroundDressing(world, WoodlandLayout.Layout(world).Trees);
        var fauna = WoodlandLayout.FaunaDressing(world, WoodlandLayout.Layout(world).Trees, items);
        object Rows(List<WoodlandLayout.GroundItem> list) => list.Select(i => (object)new Obj().Put("id", (double)i.Id).Put("asset", i.Asset).Put("tier", i.Tier).Put("x", i.X).Put("y", i.Y).Put("z", i.Z).Put("yaw", i.Yaw)).ToList();
        var actual = Write(new Obj().Put("items", Rows(items)).Put("fauna", Rows(fauna)));
        Assert.Equal(749, fauna.Count);
        Assert.Equal(1422, items.Count);
        if (expected != actual)
        {
            int i = 0; while (i < Math.Min(expected.Length, actual.Length) && expected[i] == actual[i]) i++;
            Assert.Fail($"ground dressing differs at {i}: expected …{expected.Substring(Math.Max(0, i - 80), Math.Min(160, expected.Length - Math.Max(0, i - 80)))}… actual …{actual.Substring(Math.Max(0, i - 80), Math.Min(160, actual.Length - Math.Max(0, i - 80)))}…");
        }
    }
}
