# 天天 / Skye — 带骨骼动画的 3D 角色

根据网络参考图重新建模，采用经典粉色飞行装，增加短毛、耳部毛发、虹膜、布料法线、金属件、护目镜及飞行背包细节。参考图片及来源位于 [references/SOURCES.md](references/SOURCES.md)。

## 交付文件

| 文件 | 用途 |
| --- | --- |
| `output/Skye_Rigged.blend` | Blender 4.5 LTS 原生工程；完整网格、材质、蒙皮、IK 控制骨、动作及摄影棚。纹理已打包。 |
| `output/Skye_Animated.glb` | 推荐的通用模型；包含嵌入纹理、蒙皮、四段骨骼动画及眨眼形态键。 |
| `output/Skye_Animated.fbx` | 备用交换格式；带骨骼及烘焙动作。不同软件的材质表现可能与 Blender / GLB 有差别。 |
| `output/Skye_Preview.png` | 模型实际渲染的主视角预览。 |
| `output/Skye_Animation_Demo.mp4` | 四段动作的渲染演示；正式模型动作按 30 fps 制作。 |
| `output/textures/` | 可单独使用的虹膜和布料法线贴图。 |
| `scripts/build_skye.py` | 完整、可重复运行的建模与导出源码。 |

模型是本次根据图片制作的重建版本，背面和遮挡部位通过建模补全；并非官方原始制作资产。外观为带毛发细节的卡通 CG，仍与官方电影中的雕刻、毛发梳理和表情系统有差距。

## 骨骼和动作

- 33 根变形骨骼：躯干、颈部、头部、下颌、双眼、双耳、四肢、尾巴、背包和双翼。
- 8 根 Blender 控制骨：四足 IK 目标和四个关节方向控制点。GLB 中导出 33 根变形骨骼；IK 已采样为普通骨骼动画。
- 毛发是蒙皮网格，随角色动作变形。原生模型约 147 万三角面，包含约 12.3 万根毛发，适合桌面预览和继续制作；尚未制作移动端 LOD。
- 单个 `Blink` 形态键控制双眼闭合及上睫毛，四段 GLB 动画内均含眨眼。没有完整的语音口型或影视级面部控制系统。

| 动作 | 时长 | 内容 |
| --- | --- | --- |
| `Idle_Breathe` | 4 秒 | 呼吸、头部轻动、耳朵和尾巴轻摆 |
| `Walk` | 1.33 秒 | 原地循环行走，四足交替抬起 |
| `Happy_Tail` | 3 秒 | 歪头、张嘴、摇尾巴 |
| `Takeoff_Hover` | 5 秒 | 展翼、离地、收腿、悬停、落回及收翼 |

## 使用

本机可双击工作目录中的 `Open_Skye.cmd`，用已经下载好的便携版 Blender 打开工程。

在 Blender 中，打开 `Skye_Rigged.blend`，按空格可播放默认待机动画。选中 `Skye_Rig`，进入姿态模式即可调整骨骼。足部 IK 控制名称为 `CTRL_front_foot.L/R` 和 `CTRL_hind_foot.L/R`；`pole` 控制关节弯曲方向。

切换动画：在动作编辑器中为 `Skye_Rig` 选择上表中的动作。眼睑形态键有对应的 `动作名_Blink` 动作；可在 NLA 编辑器中同步启用骨架与眼睑上同名的轨道。请同时关闭其他 NLA 轨道，避免叠加动作。GLB 已将这两部分合并，无需另行同步。

向其他软件导入时优先选 GLB。四足角色不适合套用人形自动重定向；应使用通用骨架动画方式。姿态源文件使用 Blender 的 Z 轴向上、面朝 -Y；GLB 已转换为 glTF 标准坐标系。模型尺寸可按项目需求统一缩放。

重新生成：在本目录运行以下命令（会更新 `output/` 中的本项目输出）。

```powershell
& '.\.tools\blender-4.5.3-windows-x64\blender.exe' -b --factory-startup --python '.\scripts\build_skye.py'
```

## 验证

`scripts/validate_glb.py` 检查二进制内容、有限数值、索引、关节引用、权重归一、动画变化、眨眼通道和内嵌纹理，结果见 `output/validation.json`。

`scripts/verify_roundtrip.py` 将独立 GLB 重新导入空场景，检查骨骼与动作，并实际渲染 `output/Skye_GLB_Verified.png`。正面、侧面、背面、行走、眨眼和飞行姿态还进行了渲染检查。尚未在 Unity、Unreal 或 Maya 中逐项测试。

最终 GLB 另通过 Khronos glTF Validator 2.0.0-dev.3.10 检查：0 个错误、0 个警告、0 条提示。完整报告保存在 `output/khronos_validation.json`。

独立 Python 验证脚本需要 NumPy；Khronos 验证脚本使用 `.tools/validation` 中的 `gltf-validator` npm 包。便携 Blender 和验证依赖保留在本机 `.tools/`，不包含在模型压缩包内。
