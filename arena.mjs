const MODULE = "imperial-capital";
const ERASE_RANGE_FT = 100 / 0.3048;
const ERASE_ANGLE_DEG = 2 * Math.atan(0.5) * 180 / Math.PI;
const ERASE_ITEM = "erasefixedtarget";
const SEALS = [
  { id:"west", name:"Западная печать", x:950, y:1130 },
  { id:"east", name:"Восточная печать", x:3440, y:1130 },
  { id:"south", name:"Южная печать", x:2210, y:2490 },
];
let busy = false;

const warn = (message) => ui.notifications.warn(message);
function announce(message) {
  return ChatMessage.create({content:"<p>"+message+"</p>",speaker:{alias:"Покои Бога Молний"}});
}
function stateOf(scene) {
  return scene.getFlag(MODULE,"seals") ?? [];
}
function pending(scene) {
  return scene.templates.find(t=>t.getFlag(MODULE,"eraseWarning"));
}
function arena() {
  const scene = canvas.scene;
  if(!game.user.isGM || !canvas.ready || scene?.getFlag(MODULE,"stage")!=="throne") {
    warn("Этот макрос запускает ведущий на сцене «Покои Бога Молний».");
    return null;
  }
  const emperor = canvas.tokens.placeables.find(t=>t.actor?.getFlag(MODULE,"emperor") && !t.document.hidden);
  if(!emperor) {
    warn("На карте нужен видимый токен Императора из главы.");
    return null;
  }
  const combat = game.combats.viewed?.scene?.id===scene.id && game.combats.viewed.started ? game.combats.viewed : null;
  return {scene,emperor,combat};
}
function lock(fn) {
  return async () => {
    if(busy) return;
    busy = true;
    try {
      const context = arena();
      if(context) await fn(context);
    } catch(error) {
      console.error(MODULE,error);
      ui.notifications.error("Действие арены прервалось. Подробности в консоли Foundry.");
    } finally {
      busy = false;
    }
  };
}
async function rotateSeal({scene,emperor,combat}) {
  const tokens = canvas.tokens.controlled;
  const hero = tokens[0];
  if(tokens.length!==1 || hero.actor?.type!=="character" || hero.actor.system.attributes.hp.value<=0) {
    return warn("Выделите один токен дееспособного персонажа.");
  }
  if(combat && combat.combatant?.tokenId!==hero.id) return warn("Печать разворачивается действием в свой ход.");
  const state = stateOf(scene);
  const heroId = hero.actor.id;
  if(state.some(entry=>entry.heroId===heroId)) return warn("Этот герой уже развернул печать.");
  const center = hero.center;
  const distance = ({x,y})=>Math.max(Math.abs(center.x-x),Math.abs(center.y-y))*canvas.scene.grid.distance/canvas.scene.grid.size;
  const candidates = SEALS.filter(s=>!state.some(entry=>entry.id===s.id) && distance(s)<=10);
  candidates.sort((a,b)=>distance(a)-distance(b));
  const seal = candidates[0];
  if(!seal) return warn("Подойдите на 10 футов к свободной печати.");
  if(state.length===2) {
    await emperor.actor.update({["flags."+MODULE+".defeatedBySeals"]:true,"system.attributes.hp.value":0});
    await scene.setFlag(MODULE,"seals",[...state,{id:seal.id,heroId}]);
    const template = pending(scene);
    if(template) await template.delete();
    await announce(seal.name+" разворачивается. Белая молния уходит под пол, вырывается под троном и гасит голос Императора. Император падает.");
  } else {
    const next = [...state,{id:seal.id,heroId}];
    await scene.setFlag(MODULE,"seals",next);
    await announce(seal.name+" развёрнута. Под троном звенит металл. Печати: "+next.length+"/3.");
  }
}
async function chooseDirection(emperor) {
  const target = [...game.user.targets].find(t=>t.id!==emperor.id);
  if(game.user.targets.size===1 && target) {
    const a = emperor.center,b = target.center;
    return (Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI+360)%360;
  }
  return foundry.applications.api.DialogV2.prompt({
    window:{title:"Направление конуса «Стереть»"},
    content:'<label>Направление <select name="direction"><option value="90">Юг</option><option value="45">Юго-восток</option><option value="0">Восток</option><option value="315">Северо-восток</option><option value="270">Север</option><option value="225">Северо-запад</option><option value="180">Запад</option><option value="135">Юго-запад</option></select></label>',
    ok:{label:"Отметить конус",callback:(_event,button)=>Number(button.form.elements.direction.value)},
    rejectClose:false
  });
}
async function erase({scene,emperor,combat}) {
  if(canvas.tokens.controlled.length!==1 || canvas.tokens.controlled[0].id!==emperor.id) {
    return warn("Выделите токен Императора.");
  }
  if(emperor.actor.system.attributes.hp.value<=0) return warn("Император повержен.");
  if(combat && combat.combatant?.tokenId!==emperor.id) return warn("«Стереть» требует действия в ход Императора.");
  const template = pending(scene);
  const stamp = scene.getFlag(MODULE,"eraseTurn");
  if(combat && stamp?.combatId===combat.id && stamp.round===combat.round) {
    return warn("В этом раунде Император уже потратил действие на «Стереть».");
  }
  if(!template) {
    const direction = await chooseDirection(emperor);
    if(direction===null || direction===undefined || direction===false) return;
    const {x,y} = emperor.center;
    await scene.createEmbeddedDocuments("MeasuredTemplate",[{
      t:"cone",author:game.user.id,x:Math.round(x),y:Math.round(y),direction,distance:ERASE_RANGE_FT,angle:ERASE_ANGLE_DEG,
      fillColor:"#ad56dc",borderColor:"#f6c3ff",hidden:false,flags:{[MODULE]:{eraseWarning:true}}
    }]);
    if(combat) await scene.setFlag(MODULE,"eraseTurn",{combatId:combat.id,round:combat.round});
    await announce("Император очерчивает конус «Стереть». На следующем ходу в отмеченную область ударит молния.");
    return;
  }
  const shape = template.object?.shape;
  if(!shape) return warn("Размер конуса ещё не рассчитан. Подождите, пока шаблон появится на карте.");
  const targets = canvas.tokens.placeables.filter(t=>{
    if(t.id===emperor.id || !t.actor) return false;
    const {x,y} = t.center;
    return shape.contains(x-template.x,y-template.y);
  });
  if(targets.length) {
    if(!game.modules.get("midi-qol")?.active || !globalThis.MidiQOL?.completeActivityUse) {
      return warn("Для удара макросом включите Midi-QOL или выберите отмеченные цели и используйте служебную активность «Стереть · по отмеченным целям».");
    }
    const activity = emperor.actor.items.get(ERASE_ITEM)?.system.activities.get("mainactivity0000");
    if(!activity) return warn("У Императора отсутствует служебная активность «Стереть».");
    const workflow = await MidiQOL.completeActivityUse(activity,{
      configure:false,
      midiOptions:{
        ignoreUserTargets:true,
        targetUuids:targets.map(t=>t.document.uuid),
        autoRollDamage:"always",
        fastForwardDamage:true,
        workflowOptions:{targetConfirmation:"none",autoRollDamage:"always"},
      }
    },{configure:false},{systemCard:false});
    if(!workflow || workflow.aborted) return warn("Midi-QOL прервал удар. Шаблон сохранён.");
  } else {
    await announce("Молния выжигает камень в отмеченной области. Конус никого не задел.");
  }
  await template.delete();
  if(combat) await scene.setFlag(MODULE,"eraseTurn",{combatId:combat.id,round:combat.round});
}
async function reset({scene,emperor,combat}) {
  const confirmed = await foundry.applications.api.DialogV2.confirm({
    window:{title:"Сбросить арену?"},
    content:"<p>Печати вернутся в исходное положение. Император восстановит HP и легендарные ресурсы.</p>",
    rejectClose:false,
  });
  if(!confirmed) return;
  await scene.unsetFlag(MODULE,"seals");
  await scene.unsetFlag(MODULE,"eraseTurn");
  const template = pending(scene);
  if(template) await template.delete();
  await emperor.actor.update({
    ["flags."+MODULE+".defeatedBySeals"]:false,
    "system.attributes.hp.value":emperor.actor.system.attributes.hp.max,
    "system.resources.legact.spent":0,"system.resources.legres.spent":0,
  });
  if(emperor.actor.statuses.has("dead")) await emperor.actor.toggleStatusEffect("dead",{active:false});
  const combatant = combat?.combatants.find(c=>c.tokenId===emperor.id);
  if(combatant?.defeated) await combatant.update({defeated:false});
  ui.notifications.info("Печати, конус и Император сброшены.");
}
Hooks.once("init",()=>{
  game.modules.get(MODULE).api = {rotateSeal:lock(rotateSeal),erase:lock(erase),reset:lock(reset)};
});
Hooks.on("preUpdateActor",(actor,changes)=>{
  if(!actor.getFlag(MODULE,"emperor") || actor.getFlag(MODULE,"defeatedBySeals")) return;
  if(actor.token?.parent?.getFlag(MODULE,"stage")!=="throne") return;
  const hp = "system.attributes.hp.value";
  const won = "flags."+MODULE+".defeatedBySeals";
  const updatedHp = changes[hp] ?? foundry.utils.getProperty(changes,hp);
  const isVictory = changes[won] ?? foundry.utils.getProperty(changes,won);
  if(updatedHp!==undefined && updatedHp<=0 && !isVictory) {
    if(Object.hasOwn(changes,hp)) changes[hp] = 1;
    else foundry.utils.setProperty(changes,hp,1);
  }
});
