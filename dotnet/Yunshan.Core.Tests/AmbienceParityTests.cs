using System.Text;
using Xunit;

namespace Yunshan.Core.Tests;

/// <summary>Replays scripts/parity/ambience.ts: every ambience level equals the TypeScript value.</summary>
public class AmbienceParityTests
{
    [Fact]
    public void LevelsMatchTypeScript()
    {
        var rows = (List<object>)Yunshan.Core.Host.Json.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Parity", "ambience.json"), Encoding.UTF8));
        Assert.True(rows.Count > 1000);
        foreach (Dictionary<string, object> row in rows)
        {
            var i = (Dictionary<string, object>)row["input"]; var p = (Dictionary<string, object>)i["position"]; var want = (Dictionary<string, object>)row["levels"];
            var got = Ambience.Levels(new AmbienceInput { Hour = (double)i["hour"], Position = new Vec3((double)p["x"], (double)p["y"], (double)p["z"]), Ground = (double)i["ground"], WaterDistance = (double)i["waterDistance"], NearbyPeople = (int)(double)i["nearbyPeople"], WalkingSpeed = (double)i["walkingSpeed"], Inside = (bool)i["inside"], Weather = (string)i["weather"], Paused = (bool)i["paused"] });
            Assert.Equal((double)want["wind"], got.Wind); Assert.Equal((double)want["water"], got.Water); Assert.Equal((double)want["crowd"], got.Crowd);
            Assert.Equal((double)want["birds"], got.Birds); Assert.Equal((double)want["insects"], got.Insects); Assert.Equal((double)want["steps"], got.Steps);
        }
    }
}
