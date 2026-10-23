using System.Text;
using Xunit;

namespace Yunshan.Core.Tests;

/// <summary>Replays scripts/parity/near-camera.ts: every near-camera decision equals the TypeScript value.</summary>
public class NearCameraParityTests
{
    [Fact]
    public void DecisionsMatchTypeScript()
    {
        var doc = (Dictionary<string, object>)Yunshan.Core.Host.Json.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Parity", "near-camera.json"), Encoding.UTF8));
        Vec3 V(object o) { var d = (Dictionary<string, object>)o; return new Vec3((double)d["x"], (double)d["y"], (double)d["z"]); }
        var camera = V(doc["camera"]); var rows = (List<object>)doc["rows"]; int hidden = 0;
        foreach (Dictionary<string, object> row in rows) { bool clears = NearCamera.Clears(camera, V(row["feet"])); Assert.Equal((bool)row["clears"], clears); if (!clears) hidden++; }
        Assert.Equal(600, rows.Count); Assert.True(hidden > 20 && hidden < 300);
        var vehicles = (List<object>)doc["vehicles"]; int inside = 0;
        foreach (Dictionary<string, object> v in vehicles)
        {
            bool clears = NearCamera.VehicleClears(camera, V(v["position"]), (double)v["direction"], (double)v["length"], (double)v["width"], (double)v["lift"]);
            Assert.Equal((bool)v["clears"], clears); if (!clears) inside++;
        }
        Assert.True(vehicles.Count > 1000 && inside > 20, $"{inside} enclosing of {vehicles.Count}");
    }
}
