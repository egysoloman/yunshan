using System.IO.Compression;
using System.Text;
using Xunit;

namespace Yunshan.Core.Tests;

/// <summary>Replays scripts/parity/ground-glow.ts on the current-v8 product world.</summary>
public class GroundGlowParityTests
{
    static string Gunzip(string name)
    {
        using var file = File.OpenRead(Path.Combine(AppContext.BaseDirectory, "Parity", name));
        using var gzip = new GZipStream(file, CompressionMode.Decompress);
        using var reader = new StreamReader(gzip, Encoding.UTF8); return reader.ReadToEnd();
    }

    [Fact]
    public void PoolsMatchTypeScript()
    {
        var world = Yunshan.Core.Host.WorldJson.FromJson((Dictionary<string, object>)Yunshan.Core.Host.Json.Parse(Gunzip("world-current-v8.json.gz")));
        var want = (List<object>)Yunshan.Core.Host.Json.Parse(Gunzip("ground-glow-v8.json.gz"));
        var got = GroundGlow.Pools(world);
        Assert.Equal(want.Count, got.Count);
        for (int i = 0; i < got.Count; i++)
        {
            var row = (List<object>)want[i];
            Assert.Equal((double)row[0], got[i].X); Assert.Equal((double)row[1], got[i].Y); Assert.Equal((double)row[2], got[i].Z); Assert.Equal((double)row[3], got[i].Radius);
            if (row[4] == null) Assert.Null(got[i].Along);
            else { var a = (List<object>)row[4]; Assert.NotNull(got[i].Along); for (int k = 0; k < 3; k++) Assert.Equal((double)a[k], got[i].Along![k]); }
        }
    }
}
