using System.IO.Compression;
using System.Text;
using Xunit;

namespace Yunshan.Core.Tests;

/// <summary>Replays scripts/parity/doorway-glow.ts on the current-v8 product world.</summary>
public class DoorwayGlowParityTests
{
    static string Gunzip(string name)
    {
        using var file = File.OpenRead(Path.Combine(AppContext.BaseDirectory, "Parity", name));
        using var gzip = new GZipStream(file, CompressionMode.Decompress);
        using var reader = new StreamReader(gzip, Encoding.UTF8); return reader.ReadToEnd();
    }

    [Fact]
    public void PanelsAndLevelsMatchTypeScript()
    {
        var world = Yunshan.Core.Host.WorldJson.FromJson((Dictionary<string, object>)Yunshan.Core.Host.Json.Parse(Gunzip("world-current-v8.json.gz")));
        var doc = (Dictionary<string, object>)Yunshan.Core.Host.Json.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Parity", "doorway-glow.json"), Encoding.UTF8));
        var byId = world.Buildings.ToDictionary(b => b.Id); int lit = 0;
        foreach (Dictionary<string, object> row in (List<object>)doc["panels"])
        {
            var got = DoorwayGlow.Panel(byId[(string)row["id"]]);
            if (row["panel"] == null) { Assert.Null(got); continue; }
            var want = (Dictionary<string, object>)row["panel"]; Assert.NotNull(got); lit++;
            Assert.Equal((double)want["x"], got!.X); Assert.Equal((double)want["y"], got.Y); Assert.Equal((double)want["z"], got.Z);
            Assert.Equal((double)want["width"], got.Width); Assert.Equal((double)want["height"], got.Height); Assert.Equal((double)want["yaw"], got.Yaw);
        }
        Assert.True(lit > 50);
        foreach (Dictionary<string, object> row in (List<object>)doc["levels"]) Assert.Equal((double)row["level"], DoorwayGlow.Level((bool)row["open"], (double)row["daylight"]));
    }
}
