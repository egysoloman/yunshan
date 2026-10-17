using System.Collections.Generic;
using System.IO.Compression;
using System.Text;
using Xunit;

namespace Yunshan.Core.Tests;

/// <summary>Replays scripts/parity/roof-shell.ts: the pitched shell and hall skirt
/// of every current-v8 program body. Exact except roofHeightAt's Math.pow terms.</summary>
public class RoofShellParityTests
{
    static string Gunzip(string name)
    {
        using var file = File.OpenRead(Path.Combine(AppContext.BaseDirectory, "Parity", name));
        using var gzip = new GZipStream(file, CompressionMode.Decompress);
        using var reader = new StreamReader(gzip, Encoding.UTF8);
        return reader.ReadToEnd();
    }

    [Fact]
    public void ShellsMatchTypeScript()
    {
        var world = Yunshan.Core.Host.WorldJson.FromJson((Dictionary<string, object>)Yunshan.Core.Host.Json.Parse(Gunzip("world-current-v8.json.gz")));
        var rows = (List<object>)Yunshan.Core.Host.Json.Parse(Gunzip("roof-shells-v8.json.gz"));
        var byId = world.Buildings.ToDictionary(b => b.Id);
        int shells = 0, skirts = 0;
        foreach (List<object> row in rows)
        {
            var b = byId[(string)row[0]]; var body = ArchitectureFloorPlan.GetBuildingBody(b);
            Assert.NotNull(body);
            var s = RoofShell.Of(b, ArchitectureFloorPlan.GetFloorPlanRoofRegions(body));
            if (row[1] == null) { Assert.Null(s); continue; }
            Assert.NotNull(s); shells++;
            Assert.Equal((string)row[1], s.Form); Assert.Equal((string)row[2], s.Color);
            var actual = new[] { s.Width, s.Depth, s.Rise, s.Position.X, s.Position.Y, s.Position.Z, s.Floor };
            for (int i = 0; i < actual.Length; i++) Assert.Equal((double)row[3 + i], actual[i]);
            if (row[10] == null) { Assert.Null(s.Skirt); continue; }
            skirts++; var k = (List<object>)row[10];
            var skirt = new[] { s.Skirt.Width, s.Skirt.Depth, s.Skirt.Rise, s.Skirt.Position.X, s.Skirt.Position.Y, s.Skirt.Position.Z, s.Skirt.Floor, s.Skirt.Hole[0], s.Skirt.Hole[1], s.Skirt.Hole[2], s.Skirt.Hole[3] };
            for (int i = 0; i < skirt.Length; i++) Assert.True(Math.Abs((double)k[i] - skirt[i]) <= 1e-9 * Math.Max(1, Math.Abs(skirt[i])), $"{b.Id} skirt[{i}] {k[i]} vs {skirt[i]}");
        }
        Assert.True(shells > 200 && skirts > 10, $"{shells} shells, {skirts} skirts");
    }

    [Fact]
    public void HipProfileMatchesWebSamples()
    {
        Assert.Equal(1, RoofShell.HeightAt("hip", 0, 0));
        Assert.Equal(.04, RoofShell.HeightAt("gable", .5, 0), 12);
        Assert.Equal(new double[] { -.5, -.23, 0, .23, .5 }, RoofShell.Grid("hip", null).Xs);
    }
}
