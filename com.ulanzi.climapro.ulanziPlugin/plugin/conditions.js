// Maps every WeatherAPI.com condition code to one of the drawings we have.
// Source: https://www.weatherapi.com/docs/conditions.json
const GROUPS = {
  clear: [1000],
  partly: [1003],
  cloudy: [1006],
  overcast: [1009],
  fog: [1012, 1030, 1033, 1036, 1039, 1042, 1135, 1147],
  dust: [1015, 1018, 1021, 1024, 1027, 1045, 1048],
  drizzle: [1063, 1150, 1153, 1180, 1183, 1240],
  rain: [1186, 1189, 1192, 1243],
  heavyRain: [1195, 1246],
  sleet: [1069, 1072, 1168, 1171, 1198, 1201, 1204, 1207, 1237, 1249, 1252, 1261, 1264],
  snow: [1066, 1210, 1213, 1255],
  heavySnow: [1114, 1117, 1216, 1219, 1222, 1225, 1258],
  thunder: [1087, 1273, 1276, 1279, 1282],
};

const BY_CODE = new Map(Object.entries(GROUPS).flatMap(([name, codes]) => codes.map((code) => [code, name])));

export const CONDITIONS = Object.keys(GROUPS);

export function conditionFromCode(code) {
  return BY_CODE.get(Number(code)) ?? 'cloudy';
}
