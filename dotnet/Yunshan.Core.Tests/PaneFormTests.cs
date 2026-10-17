using Xunit;
using Yunshan.Core.Host;

namespace Yunshan.Core.Tests;

public class PaneFormTests
{
    static Pane.Form Petition() => Pane.ListFrom(Json.Parse("""
        {"panes":[{"id":"relations","title":"人脉","sections":[{"title":"公共信息与请愿","rows":[],"entries":[],"actions":[],"notes":[],"forms":[
          {"id":"filePetition","label":"递交请愿","command":{"type":"filePetition"},"disabled":false,"fields":[
            {"key":"targetId","label":"议题","kind":"select","options":[{"value":"education","label":"教育"},{"value":"health","label":"医疗"}]},
            {"key":"title","label":"标题","kind":"text","minLength":1,"maxLength":40},
            {"key":"text","label":"内容","kind":"textarea","minLength":20,"maxLength":400},
            {"key":"value","label":"数值","kind":"number","optional":true}]}]}]}]}
        """))[0].Sections[0].Forms[0];

    [Fact]
    public void BuildsTheCommandOnlyWhenEveryFieldIsInRange()
    {
        var form = Petition();
        Assert.Equal(4, form.Fields.Count);
        Assert.Null(form.Build(new Dictionary<string, string> { ["title"] = "修桥", ["text"] = "太短" }));
        Assert.Null(form.Build(new Dictionary<string, string> { ["title"] = "   ", ["text"] = new string('字', 30) }));
        Assert.Null(form.Build(new Dictionary<string, string> { ["title"] = "修桥", ["text"] = new string('字', 401) }));
        Assert.Null(form.Build(new Dictionary<string, string> { ["targetId"] = "invented", ["title"] = "修桥", ["text"] = new string('字', 30) }));
        Assert.Null(form.Build(new Dictionary<string, string> { ["title"] = "修桥", ["text"] = new string('字', 30), ["value"] = "abc" }));
        var command = form.Build(new Dictionary<string, string> { ["title"] = "修桥", ["text"] = new string('字', 30) })!;
        Assert.Equal("filePetition", command["type"]); Assert.Equal("education", command["targetId"]); Assert.Equal("修桥", command["title"]);
        Assert.False(command.ContainsKey("value"), "a blank optional number is left out");
        var numbered = form.Build(new Dictionary<string, string> { ["targetId"] = "health", ["title"] = "修桥", ["text"] = new string('字', 30), ["value"] = "12.5" })!;
        Assert.Equal("health", numbered["targetId"]); Assert.Equal(12.5, numbered["value"]);
        Assert.False(form.Command.ContainsKey("title"), "the template is not mutated");
    }
}
