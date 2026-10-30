using System.IO.Compression;
using System.Text;
using Xunit;

namespace Yunshan.Core.Tests;

/// <summary>Replays scripts/parity/town-street.ts: current-v9's stone lamps and shop-door goods, and the
/// world's lantern glows including the lamps' own.</summary>
public class TownStreetParityTests
{
    static string Gunzip(string name)
    {
        using var file = File.OpenRead(Path.Combine(AppContext.BaseDirectory, "Parity", name));
        using var gzip = new GZipStream(file, CompressionMode.Decompress);
        using var reader = new StreamReader(gzip, Encoding.UTF8); return reader.ReadToEnd();
    }

    [Fact]
    public void PlacementsAndGlowsMatchTypeScript()
    {
        var world = Yunshan.Core.Host.WorldJson.FromJson((Dictionary<string, object>)Yunshan.Core.Host.Json.Parse(Gunzip("world-current-v9.json.gz")));
        var want = (Dictionary<string, object>)Yunshan.Core.Host.Json.Parse(Gunzip("town-street-v9.json.gz"));
        var assets = StudioLayoutParityTests.Manifest();
        var placements = (List<object>)want["placements"]; var got = StudioPropLayout.TownStreetPlacements(world, assets);
        Assert.True(placements.Count > 200);
        Assert.Equal(placements.Count, got.Count);
        for (int i = 0; i < got.Count; i++)
        {
            var row = (List<object>)placements[i];
            Assert.Equal((string)row[0], got[i].Asset); Assert.Equal((string)row[1], got[i].Id);
            Assert.Equal((double)row[2], got[i].Position.X); Assert.Equal((double)row[3], got[i].Position.Y); Assert.Equal((double)row[4], got[i].Position.Z); Assert.Equal((double)row[5], got[i].Yaw);
        }
        var glows = (List<object>)want["glows"]; var lit = LanternGlow.Of(world, 36, assets);
        Assert.Equal(glows.Count, lit.Count);
        for (int i = 0; i < lit.Count; i++)
        {
            var row = (List<object>)glows[i];
            Assert.Equal((string)row[3], lit[i].Kind);
            Assert.Equal((double)row[0], lit[i].X); Assert.Equal((double)row[1], lit[i].Y); Assert.Equal((double)row[2], lit[i].Z);
        }
        // Without asset bounds (and in older worlds) the lamps are not there.
        Assert.Equal(lit.Count - got.Count(p => p.Asset == StudioPropLayout.TownLampAsset), LanternGlow.Of(world).Count);
    }
}
