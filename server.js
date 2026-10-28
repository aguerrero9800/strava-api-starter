require("dotenv").config();

const express = require("express");
const axios = require("axios");
const { Pool } = require("pg");
const { readConfig, installMcp } = require("./mcp");

const app = express();

const PORT = process.env.PORT || 3000;
const BASE_URL =
  process.env.BASE_URL || `http://localhost:${PORT}`;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.DATABASE_URL
      ? { rejectUnauthorized: false }
      : false,
});

// ------------------------------
// DATABASE
// ------------------------------

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS strava_tokens (
      id INTEGER PRIMARY KEY,
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      expires_at BIGINT NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  console.log("✅ Base de datos lista");
}

async function saveTokens(data) {
  await pool.query(
    `
    INSERT INTO strava_tokens (
      id,
      access_token,
      refresh_token,
      expires_at,
      updated_at
    )
    VALUES (1, $1, $2, $3, NOW())
    ON CONFLICT (id)
    DO UPDATE SET
      access_token = EXCLUDED.access_token,
      refresh_token = EXCLUDED.refresh_token,
      expires_at = EXCLUDED.expires_at,
      updated_at = NOW()
    `,
    [
      data.access_token,
      data.refresh_token,
      data.expires_at,
    ]
  );

  console.log("✅ Tokens guardados en PostgreSQL");
}

async function loadTokens() {
  const result = await pool.query(`
    SELECT
      access_token,
      refresh_token,
      expires_at
    FROM strava_tokens
    WHERE id = 1
  `);

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows[0];
}

// ------------------------------
// STRAVA TOKEN
// ------------------------------

async function getAccessToken() {
  const tokens = await loadTokens();

  if (!tokens) {
    throw new Error(
      "Strava todavía no fue autorizado."
    );
  }

  const now = Math.floor(Date.now() / 1000);

  if (
    tokens.access_token &&
    Number(tokens.expires_at) > now + 60
  ) {
    return tokens.access_token;
  }

  console.log("🔄 Renovando token de Strava...");

  const response = await axios.post(
    "https://www.strava.com/oauth/token",
    new URLSearchParams({
      client_id:
        process.env.STRAVA_CLIENT_ID,

      client_secret:
        process.env.STRAVA_CLIENT_SECRET,

      refresh_token:
        tokens.refresh_token,

      grant_type:
        "refresh_token",
    }),
    {
      headers: {
        "Content-Type":
          "application/x-www-form-urlencoded",
      },
    }
  );

  await saveTokens(response.data);

  console.log("✅ Token renovado");

  return response.data.access_token;
}

// ------------------------------
// HELPERS
// ------------------------------

function calculatePace(
  movingTimeSeconds,
  distanceMeters
) {
  const distanceKm = distanceMeters / 1000;

  if (distanceKm <= 0) {
    return null;
  }

  const paceSeconds =
    movingTimeSeconds / distanceKm;

  const minutes =
    Math.floor(paceSeconds / 60);

  const seconds =
    Math.round(paceSeconds % 60);

  return (
    `${minutes}:` +
    `${String(seconds).padStart(2, "0")}/km`
  );
}

async function getRecentActivities(
  accessToken,
  perPage = 30
) {
  const response = await axios.get(
    "https://www.strava.com/api/v3/athlete/activities",
    {
      headers: {
        Authorization:
          `Bearer ${accessToken}`,
      },

      params: {
        per_page: perPage,
      },
    }
  );

  return response.data;
}

//-----------------------
// CANDADO
//-----------------------

function requireApiKey(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({
      error: "API key requerida",
    });
  }

  const [type, token] = authHeader.split(" ");

  if (
    !process.env.API_KEY ||
    type !== "Bearer" ||
    token !== process.env.API_KEY
  ) {
    return res.status(403).json({
      error: "API key inválida",
    });
  }

  next();
}

app.use("/api", requireApiKey);


// ------------------------------
// HOME
// ------------------------------

app.get("/", (req, res) => {
  res.json({
    service: "Strava Running API",
    status: "online",
    strava_login:
      `${BASE_URL}/strava/login`,
  });
});

app.get("/privacy", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Política de Privacidad - Strava Running API</title>
    </head>

    <body style="
      font-family: Arial, sans-serif;
      max-width: 800px;
      margin: 40px auto;
      padding: 0 20px;
      line-height: 1.6;
    ">

      <h1>Política de Privacidad</h1>

      <p>
        Strava Running API es una herramienta personal de análisis
        de entrenamientos de running.
      </p>

      <h2>Datos utilizados</h2>

      <p>
        La aplicación puede acceder a información de actividades
        deportivas proporcionada por Strava, incluyendo datos como
        distancia, duración, ritmo, desnivel, parciales y otras
        métricas disponibles de la actividad.
      </p>

      <h2>Finalidad</h2>

      <p>
        Estos datos se utilizan exclusivamente para consultar,
        analizar y evaluar entrenamientos deportivos solicitados
        por el usuario.
      </p>

      <h2>Almacenamiento</h2>

      <p>
        La aplicación almacena de forma segura las credenciales
        necesarias para mantener la conexión autorizada con Strava.
        Los datos de las actividades se consultan mediante la API
        de Strava cuando son necesarios para realizar los análisis.
      </p>

      <h2>Compartición de datos</h2>

      <p>
        Los datos deportivos no se venden ni se utilizan con fines
        publicitarios. La información necesaria para responder a
        una consulta puede ser procesada por los servicios utilizados
        para proporcionar la funcionalidad de análisis solicitada
        por el usuario.
      </p>

      <h2>Acceso y revocación</h2>

      <p>
        El usuario puede revocar el acceso de la aplicación a su
        cuenta de Strava desde la configuración de aplicaciones
        autorizadas de Strava.
      </p>

      <h2>Contacto</h2>

      <p>
        Esta aplicación es actualmente una herramienta privada
        destinada a uso personal.
      </p>

      <p><strong>Última actualización:</strong> agosto de 2026.</p>

    </body>
    </html>
  `);
});

// ------------------------------
// STRAVA LOGIN
// ------------------------------

app.get("/strava/login", (req, res) => {
  const params = new URLSearchParams({
    client_id:
      process.env.STRAVA_CLIENT_ID,

    redirect_uri:
      `${BASE_URL}/strava/callback`,

    response_type:
      "code",

    approval_prompt:
      "force",

    scope:
      "read,activity:read_all",
  });

  res.redirect(
    `https://www.strava.com/oauth/authorize?${params}`
  );
});

// ------------------------------
// STRAVA CALLBACK
// ------------------------------

app.get(
  "/strava/callback",
  async (req, res) => {
    const code = req.query.code;

    if (!code) {
      return res
        .status(400)
        .send(
          "No llegó ningún código desde Strava."
        );
    }

    try {
      const response = await axios.post(
        "https://www.strava.com/oauth/token",
        new URLSearchParams({
          client_id:
            process.env.STRAVA_CLIENT_ID,

          client_secret:
            process.env.STRAVA_CLIENT_SECRET,

          code,

          grant_type:
            "authorization_code",
        }),
        {
          headers: {
            "Content-Type":
              "application/x-www-form-urlencoded",
          },
        }
      );

      await saveTokens(response.data);

      console.log("✅ OAuth exitoso");
      console.log(
        "✅ Tokens persistidos en PostgreSQL"
      );

      res.send(
        "✅ Strava conectado correctamente. Ya podés cerrar esta pestaña."
      );
    } catch (error) {
      console.error(
        "Error consultando el servicio externo"
      );

      res
        .status(500)
        .send(
          "❌ Falló el intercambio con Strava."
        );
    }
  }
);

// ------------------------------
// ACTIVITIES
// ------------------------------

app.get(
  "/api/activities",
  async (req, res) => {
    try {
      const accessToken =
        await getAccessToken();

      const data =
        await getRecentActivities(
          accessToken,
          10
        );

      const activities =
        data.map((activity) => {
          const distanceKm =
            activity.distance / 1000;

          return {
            id:
              activity.id,

            name:
              activity.name,

            date:
              activity.start_date_local,

            type:
              activity.type,

            distance_km:
              Number(
                distanceKm.toFixed(2)
              ),

            moving_time_minutes:
              Number(
                (
                  activity.moving_time /
                  60
                ).toFixed(1)
              ),

            pace:
              calculatePace(
                activity.moving_time,
                activity.distance
              ),

            avg_hr:
              activity.average_heartrate ??
              null,

            max_hr:
              activity.max_heartrate ??
              null,

            elevation_gain_m:
              activity.total_elevation_gain ??
              null,
          };
        });

      res.json(activities);
    } catch (error) {
      console.error(
        "Error consultando el servicio externo"
      );

      res.status(500).json({
        error:
          "No pude obtener las actividades",
      });
    }
  }
);

// ------------------------------
// LATEST RUN
// ------------------------------

app.get(
  "/api/runs/latest",
  async (req, res) => {
    try {
      const accessToken =
        await getAccessToken();

      const data =
        await getRecentActivities(
          accessToken,
          30
        );

      const latestRun =
        data.find(
          (activity) =>
            activity.type === "Run"
        );

      if (!latestRun) {
        return res
          .status(404)
          .json({
            error:
              "No encontré actividades de running",
          });
      }

      res.json({
        id:
          latestRun.id,

        name:
          latestRun.name,

        date:
          latestRun.start_date_local,

        distance_km:
          Number(
            (
              latestRun.distance /
              1000
            ).toFixed(2)
          ),

        moving_time_minutes:
          Number(
            (
              latestRun.moving_time /
              60
            ).toFixed(1)
          ),

        pace:
          calculatePace(
            latestRun.moving_time,
            latestRun.distance
          ),

        avg_hr:
          latestRun.average_heartrate ??
          null,

        max_hr:
          latestRun.max_heartrate ??
          null,

        elevation_gain_m:
          latestRun.total_elevation_gain ??
          null,
      });
    } catch (error) {
      console.error(
        "Error consultando el servicio externo"
      );

      res.status(500).json({
        error:
          "No pude obtener el último run",
      });
    }
  }
);


// ------------------------------
// LATEST RUN DETAIL
// ------------------------------

app.get(
  "/api/runs/latest/detail",
  async (req, res) => {
    try {
      const accessToken =
        await getAccessToken();

      const data =
        await getRecentActivities(
          accessToken,
          30
        );

      const latestRun =
        data.find(
          (activity) =>
            activity.type === "Run"
        );

      if (!latestRun) {
        return res
          .status(404)
          .json({
            error:
              "No encontré actividades de running",
          });
      }

      const detailResponse =
        await axios.get(
          `https://www.strava.com/api/v3/activities/${latestRun.id}`,
          {
            headers: {
              Authorization:
                `Bearer ${accessToken}`,
            },
          }
        );

      const activity =
        detailResponse.data;

      const splits =
        (
          activity.splits_metric ??
          []
        ).map((split) => ({
          km:
            split.split,

          distance_km:
            Number(
              (
                split.distance /
                1000
              ).toFixed(2)
            ),

          moving_time_seconds:
            split.moving_time,

          pace:
            calculatePace(
              split.moving_time,
              split.distance
            ),

          elevation_difference_m:
            split.elevation_difference ??
            null,

          avg_speed_mps:
            split.average_speed ??
            null,

          grade_adjusted_speed_mps:
            split.average_grade_adjusted_speed ??
            null,
        }));

      res.json({
        id:
          activity.id,

        name:
          activity.name,

        date:
          activity.start_date_local,

        type:
          activity.type,

        summary: {
          distance_km:
            Number(
              (
                activity.distance /
                1000
              ).toFixed(2)
            ),

          moving_time_seconds:
            activity.moving_time,

          elapsed_time_seconds:
            activity.elapsed_time,

          pace:
            calculatePace(
              activity.moving_time,
              activity.distance
            ),

          avg_hr:
            activity.average_heartrate ??
            null,

          max_hr:
            activity.max_heartrate ??
            null,

          elevation_gain_m:
            activity.total_elevation_gain ??
            null,

          calories:
            activity.calories ??
            null,

          suffer_score:
            activity.suffer_score ??
            null,
        },

        splits,
      });
    } catch (error) {
      console.error(
        "Error consultando el servicio externo"
      );

      res.status(500).json({
        error:
          "No pude obtener el detalle del último run",
      });
    }
  }
);

// ------------------------------
// RECENT RUNS
// ------------------------------

app.get(
  "/api/runs/recent",
  async (req, res) => {
    try {
      const accessToken =
        await getAccessToken();

      const data =
        await getRecentActivities(
          accessToken,
          50
        );

      const runs =
        data
          .filter(
            (activity) =>
              activity.type === "Run"
          )

          .slice(0, 10)

          .map((activity) => ({
            id:
              activity.id,

            name:
              activity.name,

            date:
              activity.start_date_local,

            distance_km:
              Number(
                (
                  activity.distance /
                  1000
                ).toFixed(2)
              ),

            pace:
              calculatePace(
                activity.moving_time,
                activity.distance
              ),

            elevation_gain_m:
              activity.total_elevation_gain ??
              null,
          }));

      res.json(runs);
    } catch (error) {
      console.error(
        "Error consultando el servicio externo"
      );

      res.status(500).json({
        error:
          "No pude obtener los runs recientes",
      });
    }
  }
);

// ------------------------------
// RUN DETAIL BY ID
// ESTA RUTA DEBE IR DESPUÉS
// DE /latest Y /recent
// ------------------------------

app.get(
  "/api/runs/:id",
  async (req, res) => {
    try {
      const accessToken =
        await getAccessToken();

      const activityId =
        req.params.id;

      const response =
        await axios.get(
          `https://www.strava.com/api/v3/activities/${activityId}`,
          {
            headers: {
              Authorization:
                `Bearer ${accessToken}`,
            },
          }
        );

      const activity =
        response.data;

      res.json({
        id:
          activity.id,

        name:
          activity.name,

        date:
          activity.start_date_local,

        type:
          activity.type,

        distance_km:
          Number(
            (
              activity.distance /
              1000
            ).toFixed(2)
          ),

        moving_time_seconds:
          activity.moving_time,

        elapsed_time_seconds:
          activity.elapsed_time,

        pace:
          calculatePace(
            activity.moving_time,
            activity.distance
          ),

        avg_hr:
          activity.average_heartrate ??
          null,

        max_hr:
          activity.max_heartrate ??
          null,

        elevation_gain_m:
          activity.total_elevation_gain ??
          null,

        calories:
          activity.calories ??
          null,

        suffer_score:
          activity.suffer_score ??
          null,

        splits:
          activity.splits_metric ??
          [],

        laps:
          activity.laps ??
          [],
      });
    } catch (error) {
      console.error(
        "Error consultando el servicio externo"
      );

      res.status(500).json({
        error:
          "No pude obtener el detalle de la actividad",
      });
    }
  }
);

// ------------------------------
// SERVER
// ------------------------------

async function startServer() {
  try {
    const mcpConfig = readConfig(process.env);
    await initDatabase();
    await installMcp(app, mcpConfig);

    app.listen(PORT, () => {
      console.log(
        `🚀 Strava Running API escuchando en puerto ${PORT}`
      );

      console.log(
        `🌐 URL base: ${BASE_URL}`
      );

      console.log(
        `🔐 Login Strava: ${BASE_URL}/strava/login`
      );

      console.log(
        `🏃 Runs recientes: ${BASE_URL}/api/runs/recent`
      );
    });
  } catch (error) {
    console.error(
      "❌ No pude iniciar la aplicación:",
      error.message
    );

    process.exit(1);
  }
}

startServer();

