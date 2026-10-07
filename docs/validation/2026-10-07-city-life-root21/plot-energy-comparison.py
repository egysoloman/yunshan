#!/usr/bin/env python3
"""Plot existing ROOT21 native frames only; never import or execute the game.

Usage: python delivery-report/plot-energy-comparison.py
Outputs SVG, PNG, a source-bound data extract and a readback receipt here.
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import tempfile

os.environ.setdefault("MPLCONFIGDIR", str(Path(tempfile.gettempdir()) / "root21-matplotlib-cache"))
os.environ.setdefault("XDG_CACHE_HOME", str(Path(tempfile.gettempdir()) / "root21-chart-font-cache"))

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager


OUTPUT = Path(__file__).resolve().parent
ROOT = OUTPUT.parent
ARTIFACTS = ROOT / "native01" / "artifacts"
CUTOFF = 13
FONT = Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc")


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def load_series(case: str) -> tuple[dict, list[dict]]:
    source = ARTIFACTS / case / "FRAMES.json"
    raw = source.read_bytes()
    all_frames = json.loads(raw)
    # Keep the initialization and actual ordinary-step observations. Tick 1 also
    # has purchase/contract frames; these are not extra steps. Fed future24 is
    # intentionally excluded from this comparison.
    frames = [
        frame
        for frame in all_frames
        if frame["tick"] <= CUTOFF
        and (
            frame["label"] in ("cold-native-initialization", "warmup")
            or frame["label"].startswith("paid-work-")
        )
    ]
    assert [frame["tick"] for frame in frames] == list(range(CUTOFF + 1))
    points = []
    for frame in frames:
        grid = frame["grid"]
        hydro = grid["hydro"]
        dispatch = grid["dispatch"]
        points.append(
            {
                "tick": frame["tick"],
                "label": frame["label"],
                "clockMinutes": frame["at"],
                "farmProducedNativeFoodUnits": frame["nativeCounts"]["farmProduced"],
                "upstreamM3": hydro["upstreamM3"],
                "downstreamM3": hydro["downstreamM3"],
                "transferredM3": hydro["transferredM3"],
                "generatedKWh": hydro["generatedKWh"],
                # Tick 0 has no dispatch yet. Keep null rather than inventing a
                # zero-power measurement for an unexecuted energy phase.
                "servedKW": dispatch["servedKW"] if dispatch else None,
                "unservedKW": dispatch["unservedKW"] if dispatch else None,
                "farmServedKW": (
                    dispatch["buildings"]["other-city-farm"]["servedKW"]
                    if dispatch
                    else None
                ),
                "residual": frame["residual"],
                "completeSave": frame["save"],
            }
        )
    return (
        {
            "path": str(source),
            "bytes": len(raw),
            "sha256": sha(raw),
            "sourceFrameCount": len(all_frames),
            "retainedFrameCount": len(points),
        },
        points,
    )


def main() -> None:
    if FONT.is_file():
        font_manager.fontManager.addfont(str(FONT))
        plt.rcParams["font.family"] = font_manager.FontProperties(fname=FONT).get_name()
    plt.rcParams.update(
        {
            "font.size": 10.5,
            "axes.titleweight": "bold",
            "axes.spines.top": False,
            "axes.spines.right": False,
            "axes.edgecolor": "#C9D0DA",
            "axes.labelcolor": "#24354A",
            "text.color": "#24354A",
            "xtick.color": "#546275",
            "ytick.color": "#546275",
            "grid.color": "#DFE4EB",
            "grid.linewidth": 0.7,
            "svg.fonttype": "path",
            "axes.unicode_minus": False,
        }
    )
    data = {"version": 1, "cutoffTick": CUTOFF, "sources": {}, "series": {}}
    for case in ("fed", "depleted"):
        data["sources"][case], data["series"][case] = load_series(case)
    result_path = ARTIFACTS / "RESULT.json"
    result_raw = result_path.read_bytes()
    result = json.loads(result_raw)
    assert result["status"] == "ACTUAL_COMPLETED"
    assert result["business"]["fed"]["terminalTick"] == CUTOFF
    assert result["business"]["depleted"]["terminalTick"] == CUTOFF
    for case in ("fed", "depleted"):
        assert (
            data["series"][case][-1]["farmProducedNativeFoodUnits"]
            == result["business"][case]["actualCounts"]["farmProduced"]
        )
    data["sources"]["result"] = {
        "path": str(result_path), "bytes": len(result_raw), "sha256": sha(result_raw)
    }
    data["method"] = {
        "retainedLabels": ["cold-native-initialization", "warmup", "paid-work-1..12"],
        "excluded": ["same-tick command frames", "fed future-1..24"],
        "noResimulation": True,
        "foodUnit": "native food amount; no mass-unit conversion",
        "water": "cumulative actual upstream-to-downstream transfer, not replenishment",
        "power": "native dispatch kW, not abstract legacy P",
        "controlledPremises": ["one doorway setFocus", "speed4", "declared initial assets"],
    }
    data_path = OUTPUT / "energy-comparison-13steps.json"
    data_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")

    colors = {"fed": "#167C80", "depleted": "#C76140"}
    names = {"fed": "有电支（初始上库 10,000 m³）", "depleted": "耗尽支（初始上库 7 m³）"}
    fig, axes = plt.subplots(3, 1, figsize=(11.7, 10.2), sharex=True)
    fig.patch.set_facecolor("#FFFFFF")
    fig.suptitle("ROOT21｜有限水电与农场的实际因果", x=0.075, y=0.979, ha="left", fontsize=20, fontweight="bold")
    fig.text(0.075, 0.942, "同一前 13 普通步：每步约 1 游戏分钟；不纳入有电支额外 24 步恢复续演", fontsize=11, color="#546275")

    for case in ("fed", "depleted"):
        points = data["series"][case]
        ticks = [p["tick"] for p in points]
        axes[0].step(ticks, [p["farmProducedNativeFoodUnits"] for p in points], where="post", linewidth=2.5, color=colors[case], label=names[case])
        axes[1].plot(ticks, [p["transferredM3"] for p in points], marker="o", markersize=3.7, linewidth=2.2, color=colors[case])
        dispatched = [p for p in points if p["servedKW"] is not None]
        axes[2].plot([p["tick"] for p in dispatched], [p["servedKW"] for p in dispatched], marker="o", markersize=3.7, linewidth=2.2, color=colors[case], label=("有电" if case == "fed" else "耗尽") + "·全城供电")
        axes[2].plot([p["tick"] for p in dispatched], [p["farmServedKW"] for p in dispatched], marker="s", markersize=3.4, linestyle="--", linewidth=1.8, color=colors[case], label=("有电" if case == "fed" else "耗尽") + "·农场供电")

    axes[0].set_title("A  农场累计生产", loc="left", pad=12)
    axes[0].set_ylabel("原食物单位")
    axes[0].set_ylim(-0.025, 0.46)
    axes[0].legend(loc="upper left", frameon=False, fontsize=9.7)
    axes[0].annotate("第 12 步产粮 0.366667", xy=(12, 0.3666666666666572), xytext=(8.1, 0.27), arrowprops={"arrowstyle": "->", "color": colors["fed"]}, color=colors["fed"], fontsize=10.2)
    axes[0].text(8.5, 0.045, "耗尽支：累计生产 0", color=colors["depleted"])

    axes[1].set_title("B  水库之间累计实际转水", loc="left", pad=12)
    axes[1].set_ylabel("m³")
    axes[1].set_ylim(-3, 94)
    axes[1].text(6.3, 82, "有电支第 13 步：已转水 79.510703 m³；上库余 9,920.489297 m³", fontsize=9.6, color=colors["fed"])
    axes[1].annotate("第 2 步：7 m³ 用尽；上库余水 0", xy=(2, 7), xytext=(3.2, 29), arrowprops={"arrowstyle": "->", "color": colors["depleted"]}, color=colors["depleted"], fontsize=10.2)

    axes[2].set_title("C  每步供电：全城与农场分表", loc="left", pad=12)
    axes[2].set_ylabel("kW")
    axes[2].set_ylim(-0.4, 11.7)
    axes[2].legend(loc="upper right", ncol=2, frameon=False, fontsize=9.5)
    axes[2].annotate("耗尽支：第 2 步全城 1.3005 kW、农场 0；第 3 步起全城 0", xy=(2, 1.3004999999995643), xytext=(3.0, 4.7), arrowprops={"arrowstyle": "->", "color": colors["depleted"]}, color=colors["depleted"], fontsize=9.6)
    axes[2].set_xlabel("普通步编号（0 为初始化；1 为 warmup；2–13 为 12 步劳动）", labelpad=10)
    for ax in axes:
        ax.set_xlim(0, 13.35)
        ax.set_xticks(range(14))
        ax.grid(axis="both", alpha=0.7)
        ax.set_axisbelow(True)
    fig.text(0.075, 0.059, "受控另城 5 建筑；一次农场门口定位、4 倍速、初始机组/双库/线路声明。两支均仅劳动 12/60 分钟，毛工资各 7。", fontsize=9.2, color="#546275")
    fig.text(0.075, 0.039, "来源：native01/artifacts/{fed,depleted}/FRAMES.json。水线为实际转水；第 0 步尚无供电调度读数。", fontsize=9.2, color="#546275")
    fig.text(0.075, 0.019, "本图是实测数据图；没有游戏重跑、治疗完成、设施采购建造、补水或默认 612 建筑城有限发电的验收含义。", fontsize=9.2, color="#546275")
    fig.subplots_adjust(left=0.075, right=0.965, bottom=0.13, top=0.89, hspace=0.33)
    png_path = OUTPUT / "energy-comparison-13steps.png"
    svg_path = OUTPUT / "energy-comparison-13steps.svg"
    fig.savefig(png_path, dpi=180, facecolor="white", metadata={"Description": "ROOT21 existing native frame measurements; ticks 0–13 only"})
    fig.savefig(svg_path, facecolor="white", metadata={"Description": "ROOT21 existing native frame measurements; ticks 0–13 only"})
    plt.close(fig)
    receipt = {
        "status": "GENERATED_FROM_EXISTING_FRAMES",
        "retainedPointsPerBranch": 14,
        "stepWindow": [0, CUTOFF],
        "ordinaryStepsPerBranch": CUTOFF,
        "gameExecutions": 0,
        "sourceReadbackUnchanged": all(
            sha(Path(source["path"]).read_bytes()) == source["sha256"]
            for source in data["sources"].values()
        ),
        "sources": data["sources"],
        "outputs": {
            file.name: {"bytes": file.stat().st_size, "sha256": sha(file.read_bytes())}
            for file in (data_path, png_path, svg_path, Path(__file__).resolve())
        },
    }
    assert receipt["sourceReadbackUnchanged"]
    (OUTPUT / "CHART-RECEIPT.json").write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"status": receipt["status"], "outputs": receipt["outputs"], "sourceReadbackUnchanged": True}, ensure_ascii=False))


if __name__ == "__main__":
    main()
