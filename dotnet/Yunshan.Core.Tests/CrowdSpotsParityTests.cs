using System.Text;
using Xunit;

namespace Yunshan.Core.Tests;

/// <summary>Replays scripts/parity/crowd-spots.ts: every crowd spot equals the TypeScript value.</summary>
public class CrowdSpotsParityTests
{
    [Fact]
    public void SpotsMatchTypeScript()
    {
        var rows = (List<object>)Yunshan.Core.Host.Json.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Parity", "crowd-spots.json"), Encoding.UTF8));
        Assert.True(rows.Count >= 80); var nonEmpty = 0;
        foreach (Dictionary<string, object> row in rows)
        {
            var people = ((List<object>)row["people"]).Cast<Dictionary<string, object>>().Select(p => { var at = (Dictionary<string, object>)p["position"]; return ((double)at["x"], (double)at["z"], (string)p["state"], (bool)p["alive"]); });
            var want = (List<object>)row["spots"]; var got = CrowdSpots.Find(people);
            Assert.Equal(want.Count, got.Count); if (got.Count > 0) nonEmpty++;
            for (int i = 0; i < got.Count; i++)
            {
                var w = (Dictionary<string, object>)want[i];
                Assert.Equal((double)w["x"], got[i].X); Assert.Equal((double)w["z"], got[i].Z); Assert.Equal((int)(double)w["count"], got[i].Count);
            }
        }
        Assert.True(nonEmpty > 40);
    }

    static string Gunzip(string name)
    {
        using var file = File.OpenRead(Path.Combine(AppContext.BaseDirectory, "Parity", name));
        using var gzip = new System.IO.Compression.GZipStream(file, System.IO.Compression.CompressionMode.Decompress);
        using var reader = new StreamReader(gzip, Encoding.UTF8); return reader.ReadToEnd();
    }

    /// <summary>Replays scripts/parity/crowd-targets.ts on the current-v8 product world.</summary>
    [Fact]
    public void TargetsMatchTypeScript()
    {
        var world = Yunshan.Core.Host.WorldJson.FromJson((Dictionary<string, object>)Yunshan.Core.Host.Json.Parse(Gunzip("world-current-v9.json.gz")));
        var rows = (List<object>)Yunshan.Core.Host.Json.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Parity", "crowd-targets.json"), Encoding.UTF8));
        Assert.Equal(400, rows.Count);
        foreach (Dictionary<string, object> row in rows) Assert.Equal((string)row["target"], CrowdSpots.Target(world.Buildings, (double)row["x"], (double)row["z"]));
    }
}
