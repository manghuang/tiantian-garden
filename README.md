# 天天 / Skye — 精细骨骼动画模型 v2.1

根据网络参考图片重建的经典粉色飞行装天天。模型包含可编辑的骨架、蒙皮毛发、眼睑形态键和十一段动作。参考图片与来源保存在 [references/SOURCES.md](references/SOURCES.md)。

## 儿童实时互动服务

新增 [天天的小花园](companion/README.md)：复用当前 GLB 的浏览器互动服务。[Cloudflare 学习演示版](https://tiantian-garden.1255529524.workers.dev) 已接入中文语音识别、DeepSeek 对话/动作和默认 MiniMax Speech 2.8 Turbo；云端合成暂时不可用时，手机会尝试系统中文朗读，本机 GPU 角色声音和 MeloTTS 仍可选。预录音完整链路及打断恢复通过。双击 `Start_Local_Voice.cmd` 启动本机音色，使用期间电脑需保持开机；线上口令在 `companion/.env.production`。音色与原版的一致性、实际麦克风及浏览器播放仍待试听验收。部署见 [Cloudflare 说明](companion/CLOUDFLARE.md)，音色见 [本机运行说明](companion/local-voice/README.md)。`Start_Cloudflare.cmd` 启动 8787 本地开发版，`Start_Companion.cmd` 保留为旧 Node 入口。

## 本次更新

嘴部采用闭合基础造型，下颌沿铰链旋转，带动下唇、下巴及舌头，嘴角与脸颊平滑过渡。收拢时上下唇接触，牙齿和舌头藏入口腔；张开时露出牙龈、小牙齿和带弧度的舌面。待机、行走和嗅闻已改成更放松的闭嘴状态。

新增 `Mouth_OpenClose` 连续张合动作、张嘴幅度滑块，以及闭合 / 微张 / 张开三个按钮。

- 毛发改为更细的弯曲毛束，加入毛根到毛尖的颜色变化；重新梳理耳毛、额前卷毛和尾毛。
- 调整脸颊、鼻头、口腔和下巴，补充鼻部微表面、细胡须及柔和的眉毛细节。
- 左右眼独立眨眼、眯眼和睁大；闭合过程带弧线修正。眉毛、嘴角、舌头和护目镜垂带有独立骨骼。
- 行走和小跑区分支撑与摆动阶段，脚掌保持朝向；耳朵、尾巴和垂带有延迟摆动。
- 新增好奇张望、嗅闻、邀请玩耍、单眼眨眼和抬爪招呼；起飞动作包含展翼、收腿、悬停、落地和收翼。
- Blender 侧栏提供十一个动作按钮、六个表情预设及左右眼闭合滑块。

初始模型版本已提交为 Git `012c326`，可用于比较或恢复。

## 文件

| 文件 | 用途 |
| --- | --- |
| `output/Skye_Rigged.blend` | Blender 4.5 LTS 工程：完整网格、材质、骨架、IK、动作和摄影棚，纹理已打包。 |
| `output/Skye_Animated.glb` | 推荐交换格式：嵌入纹理、40 根变形骨骼、8 个眼睑形态键、11 段同步骨骼与表情动画。 |
| `output/Skye_Animated.fbx` | 备用交换格式：40 根变形骨骼与十一段烘焙动作，随各动作同步烘焙眼睑。 |
| `output/Skye_Mouth_Demo.mp4` | 5 秒嘴部张合演示，从闭合、微张到张开，再闭合。 |
| `output/Skye_Mouth_States.jpg` | 闭合、微张、张开的实际渲染对照。 |
| `output/Skye_Animation_Demo.mp4` | 十一段动作的节选演示，24 fps；模型动作按 30 fps 制作，演示保持原动作速度。 |
| `output/Skye_Preview.png` | 实际模型的高分辨率渲染。 |
| `output/Skye_Expressions.jpg` | 表情与动作预览汇总。 |
| `output/textures/` | 虹膜、布料法线、鼻部微表面法线贴图。 |
| `scripts/` | 可重复运行的建模、动画、导出与检查源码。 |

这是根据参考图制作的卡通 CG 重建模型；背面和遮挡部分通过建模补全。它不是官方原始资产，目前仍未达到官方电影模型的雕刻、毛发和表情精度。

## 骨架与动作

原生工程有 **40 根变形骨骼 + 8 根 IK 控制骨**。GLB / FBX 中的 IK 已烘焙为普通骨骼关键帧。毛发使用随骨架变形的网格，约 12.7 万根毛束、242 万三角面，适合桌面展示与进一步制作，尚未制作移动端 LOD。

8 个眼睑形态键为 `Blink.L/R`、`Squint.L/R`、`Wide.L/R`、`BlinkArc.L/R`；其中最后两个是自动弧线修正。眉毛、嘴角、眼球、下颌和舌头通过骨骼控制，未制作语音口型库。

| 动作 | 时长 | 内容 |
| --- | --- | --- |
| `Idle_Breathe` | 6 秒 | 放松呼吸、轻微视线变化、眨眼及耳尾轻摆，循环 |
| `Mouth_OpenClose` | 5 秒 | 缓慢闭合、微张、张开、合拢，可直接播放或继续编辑 |
| `Walk` | 1.6 秒 | 四足原地行走，分离支撑与抬脚阶段，循环 |
| `Trot` | 1 秒 | 对角足交替的小跑，循环 |
| `Happy_Tail` | 4 秒 | 开心微笑、张嘴吐舌、摇尾，循环 |
| `Curious_Look` | 5 秒 | 左右张望、歪头、单侧扬眉 |
| `Sniff` | 4 秒 | 探头嗅闻、鼻部轻动和眯眼 |
| `Play_Bow` | 4 秒 | 前身俯低、前爪伸出、摇尾邀请玩耍 |
| `Wink` | 3 秒 | 歪头、微笑、单眼闭合后恢复 |
| `Hello_Wave` | 5 秒 | 重心侧移、抬起前爪招呼 |
| `Takeoff_Hover` | 6 秒 | 展翼、起飞、收腿悬停、落地收翼 |

## 打开与操作

本机双击 `Open_Skye.cmd`，即可用便携 Blender 打开工程并加载 **Skye / 天天** 侧栏。选择动作，按空格播放；点击表情预设可以直接查看相应姿态。

在其他电脑上使用 Blender 4.5 或更新版本打开 `.blend`。在文本编辑器中选中内置文本 `Skye controls — Run Script to show sidebar` 并运行，即可显示侧栏。也可以在 Blender 的脚本界面运行 `scripts/skye_controls.py`。便携 Blender 不包含在模型压缩包中。

在侧栏的“嘴巴张合”区域拖动“张嘴幅度”：0 为闭合，1 为最大张开。按钮提供闭合、微张和张开三个姿态。手动调节会暂停骨架动作并收回舌头；重新选择动作即可恢复同步播放。开合由 `jaw` 骨驱动，最大旋转约 26°。

选中 `Skye_Rig`，进入姿态模式调整骨骼。足部目标名为 `CTRL_front_foot.L/R` 和 `CTRL_hind_foot.L/R`，`pole` 控制关节弯曲方向。骨骼集合按面部、IK、次级摆动和飞行装备分组。

手动切换动作编辑器时，骨架选择动作名，眼睑的形态键数据选择相应的 `动作名_Face`。NLA 中也有同名轨道，使用时只启用目标动作，避免叠加。侧栏会自动同步这两部分；GLB 已将它们合并为单个动作。

手动编辑闭眼形态时，需同步设置 `BlinkArc = 4 × Blink × (1 − Blink)`；使用侧栏滑块会自动完成。手动闭眼会暂停眼睑动画，重新选择动作即可恢复。

向其他软件导入时优先使用 GLB。四足角色使用通用骨架动画方式；不同软件的材质和形态键导入设置可能不同。尚未在 Unity、Unreal 或 Maya 中逐项验证。原生工程 Z 轴向上、面朝 −Y，GLB 已转换为 glTF 标准坐标系，可按需求统一缩放。

## 重建与检查

在项目目录运行（会更新本项目的 `output/` 文件）：

```powershell
& '.\.tools\blender-4.5.3-windows-x64\blender.exe' -b --factory-startup --python '.\scripts\build_skye.py'
```

构建参数 `-- --no-render` 跳过主图渲染；`-- --draft-face` 只生成无毛发的面部检查图到 `.tools/face-review/`，不会替换正式模型。`-- --draft-mouth` 快速检查无毛发的闭合、微张、张开和侧面形变。

- `validate_glb.py` 检查二进制数据、有限数值、索引、关节引用、权重归一、十一段动画变化及表情通道。
- `khronos_validate.cjs` 使用 Khronos glTF Validator 检查导出文件，报告位于 `output/khronos_validation.json`。
- `validate_mouth.py` 检查实际变形后的上下唇间距、开合幅度递增、闭嘴遮挡和再次闭合，报告位于 `output/mouth_validation.json`。
- `validate_motion.py` 逐段采样 IK 目标误差、脚掌朝向和闭眼弧线修正，报告位于 `output/motion_validation.json`。
- `verify_roundtrip.py` 将独立 GLB 导回空场景，检查骨骼和动作，实际渲染 `output/Skye_GLB_Verified.png`。
- `validate_delivery.py` 分别检查独立 FBX 的骨骼与表情动画、Blender 侧栏和 MP4 解码。
- `render_review.py` 输出正、侧、背视图以及动作和表情特写；`render_animation.py` 生成动作演示视频。
- `package_delivery.py` 更新 SHA-256 清单并打包交付文件。

独立 Python 验证需要 NumPy，Khronos 验证使用 `.tools/validation` 中的 `gltf-validator`。本机工具、缓存、逐帧渲染及旧工程备份不包含在交付包内。

本地构建日志统一保存在 `logs/`，交付压缩包输出到 `archives/`；两者均为可重新生成的本机产物，不纳入 Git。
