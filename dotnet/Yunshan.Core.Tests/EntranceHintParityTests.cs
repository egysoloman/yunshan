using System.Text;
using Xunit;

namespace Yunshan.Core.Tests;

/// <summary>Replays scripts/parity/entrance-hint.ts: every hint equals the TypeScript text.</summary>
public class EntranceHintParityTests
{
    [Fact]
    public void HintsMatchTypeScript()
    {
        var root = (Dictionary<string, object>)Yunshan.Core.Host.Json.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Parity", "entrance-hint.json"), Encoding.UTF8));
        Vec3 V(object o) { var d = (Dictionary<string, object>)o; return new Vec3((double)d["x"], d.TryGetValue("y", out var y) ? (double)y : 0, (double)d["z"]); }
        var buildings = ((List<object>)root["buildings"]).Select(o => { var d = (Dictionary<string, object>)o; return new Building { Name = (string)d["name"], Door = V(d["door"]) }; }).ToList();
        var rows = (List<object>)root["rows"]; Assert.Equal(300, rows.Count);
        int hinted = 0;
        foreach (Dictionary<string, object> row in rows)
        {
            var forward = V(row["forward"]); var got = EntranceHint.Hint(V(row["position"]), forward.X, forward.Z, buildings);
            Assert.Equal(row["hint"] as string, got); if (got != null) hinted++;
        }
        Assert.True(hinted > 100);
    }
}
