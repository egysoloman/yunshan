using System.Text;
using Xunit;

namespace Yunshan.Core.Tests;

/// <summary>Replays scripts/parity/action-cues.ts: the same tones, and the same cue for every command type.</summary>
public class ActionCuesParityTests
{
    [Fact]
    public void CuesMatchTypeScript()
    {
        var root = (Dictionary<string, object>)Yunshan.Core.Host.Json.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Parity", "action-cues.json"), Encoding.UTF8));
        var tones = (Dictionary<string, object>)root["tones"];
        Assert.Equal(tones.Keys.OrderBy(k => k), ActionCues.Tones.Keys.OrderBy(k => k));
        foreach (var (name, list) in tones)
        {
            var expected = (List<object>)list; var actual = ActionCues.Tones[name];
            Assert.Equal(expected.Count, actual.Length);
            for (int i = 0; i < actual.Length; i++)
            {
                var t = (Dictionary<string, object>)expected[i];
                Assert.Equal((double)t["frequency"], actual[i].Frequency); Assert.Equal((double)t["at"], actual[i].At);
                Assert.Equal((double)t["duration"], actual[i].Duration); Assert.Equal((double)t["gain"], actual[i].Gain); Assert.Equal((string)t["wave"], actual[i].Wave);
            }
        }
        var rows = (List<object>)root["rows"]; Assert.True(rows.Count > 100);
        foreach (Dictionary<string, object> row in rows) Assert.Equal(row["cue"] as string, ActionCues.CueFor((string)row["type"], (bool)row["ok"]));
    }
}
