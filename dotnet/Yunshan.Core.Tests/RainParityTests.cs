using System.Text;
using Xunit;

namespace Yunshan.Core.Tests;

/// <summary>Replays scripts/parity/rain.ts: every streak top equals the TypeScript value exactly.</summary>
public class RainParityTests
{
    [Fact]
    public void DropsMatchTypeScript()
    {
        var root = (Dictionary<string, object>)Yunshan.Core.Host.Json.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Parity", "rain.json"), Encoding.UTF8));
        var c = (Dictionary<string, object>)root["constants"];
        Assert.Equal(Rain.Count, (double)c["count"]); Assert.Equal(Rain.Half, (double)c["half"]); Assert.Equal(Rain.Height, (double)c["height"]); Assert.Equal(Rain.Below, (double)c["below"]);
        Assert.Equal(Rain.Fall, (double)c["fall"]); Assert.Equal(Rain.Length, (double)c["length"]); Assert.Equal(Rain.SlantX, (double)c["slantX"]); Assert.Equal(Rain.SlantZ, (double)c["slantZ"]);
        var rows = (List<object>)root["rows"]; Assert.True(rows.Count > 200);
        Vec3 V(object o) { var d = (Dictionary<string, object>)o; return new Vec3((double)d["x"], (double)d["y"], (double)d["z"]); }
        foreach (Dictionary<string, object> row in rows)
        {
            var top = Rain.Drop((int)(double)row["i"], (double)row["elapsed"], V(row["camera"])); var expected = V(row["top"]);
            Assert.Equal(expected.X, top.X); Assert.Equal(expected.Y, top.Y); Assert.Equal(expected.Z, top.Z);
        }
        Assert.True(Rain.Active("雨", false)); Assert.False(Rain.Active("雨", true)); Assert.False(Rain.Active("晴", false));
    }
}
