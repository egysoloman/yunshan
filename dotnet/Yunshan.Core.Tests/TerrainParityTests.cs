using System.Collections.Generic;
using System.IO.Compression;
using System.Text;
using Xunit;

namespace Yunshan.Core.Tests;

/// <summary>Replays scripts/parity/terrain.ts: ground heights just outside every market
/// building of current-v9, where its near-vertical plinth walls stand.</summary>
public class TerrainParityTests
{
    static string Gunzip(string name)
    {
        using var file = File.OpenRead(Path.Combine(AppContext.BaseDirectory, "Parity", name));
        using var gzip = new GZipStream(file, CompressionMode.Decompress);
        using var reader = new StreamReader(gzip, Encoding.UTF8);
        return reader.ReadToEnd();
    }

    [Fact]
    public void V9MarketPlinthsMatchTypeScript()
    {
        var world = Yunshan.Core.Host.WorldJson.FromJson((Dictionary<string, object>)Yunshan.Core.Host.Json.Parse(Gunzip("world-current-v9.json.gz")));
        var rows = (List<object>)Yunshan.Core.Host.Json.Parse(Gunzip("terrain-v9.json.gz"));
        Assert.True(rows.Count > 1000);
        foreach (List<object> row in rows)
        {
            double x = (double)row[0], z = (double)row[1], expected = (double)row[2], actual = World.TerrainHeight(world, x, z, true);
            Assert.True(Math.Abs(expected - actual) <= 1e-9 * Math.Max(1, Math.Abs(expected)), $"({x}, {z}): {expected} vs {actual}");
        }
    }
}
