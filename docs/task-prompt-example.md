Work on Linear issue IGN-21:

Suggested branch name: devops/ign-21-cargar-las-variables-de-entorno-en-secret-manager-staging-y

<issue identifier="IGN-21">
<title>Cargar las variables de entorno en Secret Manager (staging y prod)</title>
<description>
## Contexto

Los archivos `.env` no están en los repos y solo los tiene Richo. Cloud Build los leerá desde Secret Manager.

## Qué hacer

* **itk-api** (`functions/src/Env/.env.prod` y `.env.dev`): `ENV_PREFIX`, `CLICKUP_API_TOKEN`, `CLICKUP_B2B_LIST_ID`, `META_ACCESS_TOKEN`, `META_PIXEL_ID`, `META_TEST_EVENT_CODE`, `USER_ACTIVATION_JWT_SECRET`, `FRONTEND_ACTIVATION_URL`, `FIREBASE_API_KEY` (opcional `INCLUDE_FULL_RESULTS`). Es la lista completa de lo que leen las funciones en `main`; `FIREBASE_PROJECT_ID`, `GOOGLE_APPLICATION_CREDENTIALS` y `DRY_RUN` solo los usan los scripts locales de `functions/src/scripts/` y no van aquí. Las llaves de Stripe, Twilio, [seats.io](<http://seats.io>), Landbot y Bird tampoco: hoy ningún código las lee de `process.env` (se migran en <issue id="9d034827-c9d3-40f7-858a-c85ebc81da81" href="https://linear.app/igniacanada/issue/IGN-32/leer-las-llaves-del-backend-desde-secret-manager-con-definesecret">IGN-32</issue>).
* **itk-panel-admin** e **itk-visitor**: el contenido de `src/.env.prod` y `src/.env.dev.cloud`. En el panel, agregar las 7 llaves `FIREBASE_*` que lee `develop` y confirmar que `VITE_MOCK_PLATFORM_ADMIN` no esté en `true` (`src/stores/app-store.ts:77` da permisos de plataforma en la UI). Agregar `src/.env.example` al panel (la web ya lo tiene). En la web, incluir `SITE_URL` y `FIREBASE_*` para `generate:sitemap`.
* Un secreto por archivo de entorno (por ejemplo `itk-api-env-prod`) es suficiente para la fase 1.
* Cargar los valores directo en Secret Manager (consola o `gcloud`). No compartirlos por Linear, Slack ni correo.

## Criterios de aceptación

- [ ] Los secretos existen en el proyecto correspondiente y `cloudbuild-deployer` puede leerlos.
- [ ] Confirmado que `ENV_PREFIX` es `prod_` en prod y `dev_` en staging, y que staging usa llaves de prueba (Stripe en modo test).

## Nota

Las llaves que hoy están escritas en `Shared/constants.ts` se mueven en el trabajo de seguridad, no en este ticket.

---

Plan de CI/CD: CI en GitHub Actions, CD en Cloud Build. Flujo: merge a `develop` → CI y deploy a **staging** (`access-tech-dev`); merge a `main` → CI y deploy a **prod** (`access-tech`), con aprobación manual.
</description>
<team name="Ignia Canada"/>
<label>infra</label>
<project name="Infraestructura ITK: CI/CD, staging y Terraform">Lo que Ignia propone construir para Instatickets: CI en GitHub Actions, CD con Cloud Build a staging y producción, Secret Manager y Terraform. Los hallazgos de la revisión están en el proyecto Auditoría técnica ITK.</project>
<issue-relations>
<blocking>
<issue-ref identifier="IGN-22" title="Pipeline de Cloud Build para desplegar Functions de itk-api"/>
<issue-ref identifier="IGN-23" title="Pipeline de Cloud Build para desplegar itk-panel-admin en Hosting"/>
<issue-ref identifier="IGN-24" title="Pipeline de Cloud Build para desplegar itk-visitor en Hosting"/>
</blocking>
<blocked-by><issue-ref identifier="IGN-19" title="Preparar GCP para el CD con Cloud Build (staging y prod)"/></blocked-by>
<related>
<issue-ref identifier="IGN-32" title="Leer las llaves del backend desde Secret Manager con `defineSecret`"/>
<issue-ref identifier="IGN-11" title="CI en GitHub Actions para itk-api"/>
<issue-ref identifier="IGN-17" title="Correr en CI las pruebas de reglas de Firestore con emulador"/>
<issue-ref identifier="IGN-25" title="Crear los triggers de Cloud Build (develop→staging, main→prod con aprobación)"/>
<issue-ref identifier="IGN-28" title="Retirar las llaves JSON de cuenta de servicio del workflow anterior"/>
<issue-ref identifier="IGN-33" title="Rotar las llaves que estuvieron en el código"/>
</related>
</issue-relations>
</issue>

<comment-thread comment-id="42be7f94-766b-4416-92d4-d69928fc0884">
<comment author="Richo" created-at="2026-10-20T15:40:54.465Z">
tatus: In progress. Repo-side inventory is done. No secret has been created or verified yet. gcloud login is done (`admin@instatickets.mx`). Secret Manager is not enabled in `access-tech-dev` or `access-tech`. It stays disabled until the decision below is made.

Contradiction with the current repo

This ticket and the project plan assume CD in Cloud Build, with values read from Secret Manager by `cloudbuild-deployer`. The repo already deploys from GitHub Actions:

* `platform/backend/.github/workflows/rules-test.yml`, job `deploy-dev`, deploys Firestore and Storage rules to `access-tech-dev` on push to `develop` and `main`. It authenticates with WIF (`GCP_WIF_PROVIDER`, `GCP_DEV_SA`) and uses the `dev` environment.
* <issue id="cb2bc3b9-c2d3-4cd6-b19d-4eb8ff6f7a1a" href="https://linear.app/igniacanada/issue/IGN-11/ci-en-github-actions-para-itk-api">IGN-11</issue> says CI has no deploy. The <issue id="8f19a426-9e21-4237-97ad-69ea5abf8951" href="https://linear.app/igniacanada/issue/IGN-17/correr-en-ci-las-pruebas-de-reglas-de-firestore-con-emulador">IGN-17</issue> response already records that `deploy-dev` conflicts with <issue id="cb2bc3b9-c2d3-4cd6-b19d-4eb8ff6f7a1a" href="https://linear.app/igniacanada/issue/IGN-11/ci-en-github-actions-para-itk-api">IGN-11</issue>.

Proposed resolution, pending decision: deploy Functions from GitHub Actions after tests pass, with the same WIF auth and GitHub environment secrets and variables (`dev`, `prod`). Values would be written to `functions/lib/.env` at deploy time, as `write-env` does in `cloudbuild.yaml`. Under that option, Secret Manager and the `cloudbuild-deployer` grant are not needed for the phase 1 deploy. Runtime secrets (<issue id="9d034827-c9d3-40f7-858a-c85ebc81da81" href="https://linear.app/igniacanada/issue/IGN-32/leer-las-llaves-del-backend-desde-secret-manager-con-definesecret">IGN-32</issue>) would still need Secret Manager.

Trade-off: values baked into the deployed config mean a rotation requires a redeploy.

Impact: acceptance criterion 1 and open items 1, 2, and 5 depend on this decision. <issue id="eb0ea695-ac68-4a6b-91fa-5a0869611695" href="https://linear.app/igniacanada/issue/IGN-19/preparar-gcp-para-el-cd-con-cloud-build-staging-y-prod">IGN-19</issue>, <issue id="21b6b759-822e-45c7-a1aa-b8f1cd7b92b3" href="https://linear.app/igniacanada/issue/IGN-22/pipeline-de-cloud-build-para-desplegar-functions-de-itk-api">IGN-22</issue>, <issue id="50610d9a-592e-4d1d-b786-20f709e2261e" href="https://linear.app/igniacanada/issue/IGN-25/crear-los-triggers-de-cloud-build-developstaging-mainprod-con">IGN-25</issue>, and <issue id="22baa7c3-b451-49d1-b653-e7351d290c38" href="https://linear.app/igniacanada/issue/IGN-28/retirar-las-llaves-json-de-cuenta-de-servicio-del-workflow-anterior">IGN-28</issue> describe Cloud Build and need the same decision.

What was checked

itk-api, names read by `origin/main` (`process.env`):

* `ENV_PREFIX`, `CLICKUP_API_TOKEN`, `CLICKUP_B2B_LIST_ID` (`API/b2b/submitLead.ts`), `META_ACCESS_TOKEN`, `META_PIXEL_ID`, `META_TEST_EVENT_CODE` (`Utils/meta/conversionsApi.ts:356`, optional), `USER_ACTIVATION_JWT_SECRET` (`API/user/activateUser.ts`, `Utils/security/sendActivationEmail.ts`), `FRONTEND_ACTIVATION_URL`.
* `FIREBASE_PROJECT_ID` and `DRY_RUN` are read only in `functions/src/scripts/`, as the ticket says.

Local env files (`functions/src/Env/`, key names and prefixes only):

* `ENV_PREFIX=prod_` in `.env.prod` and `ENV_PREFIX=dev_` in `.env.dev`. Both match the ticket.
* `CLICKUP_B2B_LIST_ID` is present in both.
* `USER_ACTIVATION_JWT_SECRET`, `FRONTEND_ACTIVATION_URL`, and `FIREBASE_API_KEY` are absent from both. Activation fails without the first two.
* `STRIPE_SECRET_KEY` is `sk_live` in `.env.prod` and `sk_test` in `.env.dev`. These stay out of the secret (<issue id="9d034827-c9d3-40f7-858a-c85ebc81da81" href="https://linear.app/igniacanada/issue/IGN-32/leer-las-llaves-del-backend-desde-secret-manager-con-definesecret">IGN-32</issue>).

Panel (`apps/admin/src/`):

* `.env.prod` has the 7 `FIREBASE_*` keys and no `VITE_MOCK_PLATFORM_ADMIN`. This passes.
* `.env.dev.cloud` has `VITE_MOCK_PLATFORM_ADMIN=true`. Using it as the staging source fails the ticket's check. `app-store.ts:77` then grants platform-admin UI access.
* `.env.dev.cloud` has `STRIPEPK=pk_live`. This conflicts with the staging test-mode criterion.
* `.env.example` does not exist. The ticket asks to add it.

Web (`apps/visitor/src/`):

* `.env.prod` and `.env.dev.cloud` both include `SITE_URL` and the `FIREBASE_*` keys that `generate:sitemap` needs. `.env.dev.cloud` uses `pk_test`. This passes.
* `.env.example` exists.

Code note: several `ENV_PREFIX` checks use `!== null`. An unset variable is `undefined`, so the check passes and names become `undefined…`. The secret value is the only real guard.
</comment>
</comment-thread>

<comment-thread comment-id="eafc1555-f1db-4aeb-a855-c078ccbd6847">
<comment author="Jaime Limón" created-at="2026-10-29T19:35:16.234Z">
**Revisión del 29 oct 2026** (código en GitHub sin cambios desde el 20 oct: `develop` b61c9be, `main` ffe1e92)

**Estado:** No verificable desde el código

* `develop` lee Stripe y [seats.io](<http://seats.io>) de `process.env` (`constants.ts:13-30`); en staging un valor faltante queda `''` sin error.
* Landbot y Bird caen a valores fijos (`:36-38`).

**Falta:** armar el secreto con la lista de `develop`.
</comment>
</comment-thread>