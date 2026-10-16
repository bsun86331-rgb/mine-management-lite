# 坐标转换依赖

- Proj4js v2.22.0，MIT 许可见 [proj4-LICENSE.md](proj4-LICENSE.md)。
- [官方发布包](https://github.com/proj4js/proj4js/releases/tag/v2.22.0)，使用发布附件 dist.zip 内的 dist/proj4.js，未改动库源码。
- [Proj4js 使用说明](https://proj4js.org/)，[UTM 投影说明](https://proj.org/en/stable/operations/projections/utm.html)。
- 本项目以 WGS84 经纬度为 GPS 内部位置，表单显示 WGS84 / UTM，X=Easting（东向）、Y=Northing（北向），平面单位为米。分区与半球随坐标保存；不把米值直接用作经纬度。
- 新增高程独立保存，不进行垂直基准转换。浏览器返回高度按 [W3C Geolocation](https://www.w3.org/TR/geolocation/#altitude) 的 WGS84 椭球高含义标记，与手填高程区分。
