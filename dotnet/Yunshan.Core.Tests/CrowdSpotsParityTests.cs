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
}
