using System.Collections.Generic;
using Xunit;
using Yunshan.Core;
using Yunshan.Core.Host;

namespace Yunshan.Core.Tests;

public class SimHostClientTests
{
    static string RepositoryRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null && !File.Exists(Path.Combine(dir.FullName, "package.json"))) dir = dir.Parent;
        return dir?.FullName ?? throw new InvalidOperationException("repository root not found");
    }

    static string WorldReference(string layout)
    {
        using var file = File.OpenRead(Path.Combine(AppContext.BaseDirectory, "Parity", $"world-{layout}.json.gz"));
        using var gzip = new System.IO.Compression.GZipStream(file, System.IO.Compression.CompressionMode.Decompress);
        using var reader = new StreamReader(gzip, System.Text.Encoding.UTF8);
        return reader.ReadToEnd();
    }

    [Fact]
    public void JsonRoundTripsProtocolValues()
    {
        var text = Json.Write(new Dictionary<string, object> { ["op"] = "step", ["seconds"] = .25, ["player"] = new Vec3(1.5, -2, 3e21), ["text"] = "云山\n\"引号\"", ["list"] = new List<object?> { true, null, 7 } });
        Assert.Equal("{\"op\":\"step\",\"seconds\":0.25,\"player\":{\"x\":1.5,\"y\":-2,\"z\":3e+21},\"text\":\"云山\\n\\\"引号\\\"\",\"list\":[true,null,7]}", text);
        var back = (Dictionary<string, object>)Json.Parse(text);
        Assert.Equal("云山\n\"引号\"", back["text"]);
        Assert.Equal(3e21, Json.Vec(back["player"]).Z);
        Assert.Throws<FormatException>(() => Json.Parse("{\"a\":1,}"));
    }

    [Fact]
    public async Task DrivesTheAuthoritativeHostProcess()
    {
        var root = RepositoryRoot();
        var launch = HostLaunch.Resolve(null, root);
        Assert.NotNull(launch);
        using var client = launch.Start();
        var opened = await client.Open();
        Assert.Equal("current-v8", Json.Str(opened, "layout"));
        Assert.Equal(20261001d, Json.Num(opened, "seed"));

        // The host sends the city it simulates; C# receives it byte for byte
        // (canonical JSON of the TypeScript world, scripts/parity/world.ts).
        var world = await client.World();
        Assert.Equal(world.Buildings.Count, (int)Json.Num(opened, "buildings"));
        Assert.Equal(world.Edges.Count, (int)Json.Num(opened, "edges"));
        Assert.Equal(WorldReference("current-v8"), CanonicalJson.Write(CanonicalJson.World(world)));
        // The host also sends where a new player first looks: 60 m out at the spawn, never straight down.
        Assert.NotNull(client.ArrivalLook);
        Assert.Equal(60, Math.Sqrt(Math.Pow(client.ArrivalLook.X - world.Spawn.X, 2) + Math.Pow(client.ArrivalLook.Z - world.Spawn.Z, 2)), 6);

        var frame = await client.Step(.25, "walk", world.Spawn, null, 300, 0);
        Assert.Equal(1d, frame.Ticks);
        Assert.Contains(frame.Events, e => e.Type == "arrival");
        Assert.All(frame.Vehicles, v => Assert.Contains(world.Edges, e => e.Id == v.EdgeId));
        Assert.True(frame.Player.Alive);

        var (ok, message, paused) = await client.Command(new Dictionary<string, object> { ["type"] = "pause", ["value"] = 1 }, null, 300, frame.LastEventId);
        Assert.True(ok, message);
        Assert.True(paused.Paused);
        var still = await client.Step(1, "walk", world.Spawn, null, 300, paused.LastEventId);
        Assert.Equal(0d, still.Ticks);

        var sections = await client.Context("walk", null);
        Assert.All(sections, s => Assert.All(s.Actions, a => Assert.True(a.Client == "interact" || a.Command != null)));

        var save = await client.Save();
        Assert.Contains("\"format\":\"yunshan-save\"", save);
        await Assert.ThrowsAsync<SimHostException>(() => client.Request("teleport"));
    }
}
