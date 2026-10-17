using System.IO.Compression;
using System.Text;
using Xunit;

namespace Yunshan.Core.Tests;

/// <summary>Replays scripts/parity/lantern-glow.ts on the current-v8 product world.</summary>
public class LanternGlowParityTests
{
    static string Gunzip(string name)
    {
        using var file = File.OpenRead(Path.Combine(AppContext.BaseDirectory, "Parity", name));
        using var gzip = new GZipStream(file, CompressionMode.Decompress);
        using var reader = new StreamReader(gzip, Encoding.UTF8); return reader.ReadToEnd();
    }

    [Fact]
    public void GlowPositionsMatchTypeScript()
    {
        var world = Yunshan.Core.Host.WorldJson.FromJson((Dictionary<string, object>)Yunshan.Core.Host.Json.Parse(Gunzip("world-current-v8.json.gz")));
        var want = (List<object>)Yunshan.Core.Host.Json.Parse(Gunzip("lantern-glow-v8.json.gz"));
        var got = LanternGlow.Of(world);
        Assert.Equal(want.Count, got.Count);
        for (int i = 0; i < got.Count; i++)
        {
            var row = (List<object>)want[i];
            Assert.Equal((string)row[3], got[i].Kind);
            Assert.Equal((double)row[0], got[i].X); Assert.Equal((double)row[1], got[i].Y); Assert.Equal((double)row[2], got[i].Z);
        }
        Assert.Equal(0, LanternGlow.Night(1)); Assert.Equal(1, LanternGlow.Night(0)); Assert.Equal(1 - .3 * 1.6, LanternGlow.Night(.3));
    }
}
