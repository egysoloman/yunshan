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
