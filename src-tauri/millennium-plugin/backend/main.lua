-- Pont entre 3DSteam et l'interface de Steam (installé par 3DSteam, voir `millennium.rs`).
--
-- 3DSteam dépose une commande dans `bridge/command.json` ; le frontend du plugin vient la
-- chercher par `poll`, l'exécute dans l'interface de Steam, puis renvoie le résultat par `report`,
-- écrit dans `bridge/result-<id>.json`. `poll` tient aussi à jour `bridge/heartbeat` (heure et
-- version) : 3DSteam sait ainsi que le plugin tourne, et ce qu'il sait faire. Aucun port n'est
-- ouvert.

local logger     = require("logger")
local millennium = require("millennium")
local utils      = require("utils")
local fs         = require("fs")
local json       = require("json")

-- Même version que `plugin.json` (vérifié par les tests de `millennium.rs`).
local VERSION = "1.1.0"
local BRIDGE = fs.parent_path(utils.get_backend_path()) .. "/bridge"
local last_heartbeat = 0

local function read_file(path)
    local file = io.open(path, "rb")
    if not file then return nil end
    local content = file:read("*a")
    file:close()
    return content
end

-- Écrit puis renomme : 3DSteam ne lit jamais un fichier à moitié écrit.
local function write_file(path, content)
    local tmp = path .. ".tmp"
    local file = io.open(tmp, "wb")
    if not file then return false end
    file:write(content)
    file:close()
    os.remove(path)
    return os.rename(tmp, path) ~= nil
end

-- Millennium n'accepte pas `nil` en retour : on renvoie toujours une chaîne JSON.
function poll(payload)
    local now = os.time()
    if now ~= last_heartbeat then
        last_heartbeat = now
        write_file(BRIDGE .. "/heartbeat", tostring(now) .. " " .. VERSION)
    end
    local path = BRIDGE .. "/command.json"
    local command = read_file(path)
    if not command or command == "" then return "null" end
    os.remove(path)
    return command
end

function report(payload)
    local ok, result = pcall(json.decode, payload)
    if not ok or type(result) ~= "table" or type(result.id) ~= "string" or not result.id:match("^[%w%-]+$") then
        return "false"
    end
    return write_file(BRIDGE .. "/result-" .. result.id .. ".json", payload) and "true" or "false"
end

local function on_load()
    logger:info("3DSteam bridge loaded: " .. BRIDGE)
    millennium.ready()
end

return { on_load = on_load, on_frontend_loaded = function() end, on_unload = function() end }
