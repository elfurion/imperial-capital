import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { compilePack } from "@foundryvtt/foundryvtt-cli";
import { cast, encounters, finalRules, ids } from "./encounters.mjs";
import sharp from "sharp";

const id = "imperial-capital";
const asset = (path) => "modules/"+id+"/assets/"+path;
const pad = (value) => value.length > 16 ? createHash("sha256").update(value).digest("hex").slice(0,16) : value.padEnd(16,"0");
const keyables = ["str","dex","con","int","wis","cha"];
const stats = { coreVersion:"13.347",systemId:"dnd5e",systemVersion:"5.2.5",createdTime:null,modifiedTime:null,lastModifiedBy:null };
const actId = "mainactivity0000";
const icon = {
  force:"icons/magic/control/buff-flight-wings-runes-blue.webp",
  lightning:"icons/magic/lightning/bolt-forked-teal.webp",
  psychic:"icons/magic/control/buff-flight-wings-runes-purple.webp",
  slashing:"icons/weapons/swords/sword-katana.webp",
};
const imgFor = (path) => path.startsWith("assets/") ? "modules/"+id+"/"+path : path;

const spellRanks = { sui:{0:0,1:5}, mei:{0:0,1:6,2:3}, gao:{2:5}, li:{1:0,2:8} };
function feature(actorKey, action, index) {
  const rank = spellRanks[actorKey]?.[index];
  const itemId = action.id ?? pad(actorKey+"feature"+(index+1));
  const name = action.name;
  const img = icon[action.damage?.[0]?.types[0]] ?? "icons/svg/book.svg";
  const usage = action.recharge ? [{period:"recharge",type:"recoverAll",formula:action.recharge}]
    : action.limit ? [{period:"day",type:"recoverAll",formula:""}] : [];
  const consumption = action.resistance ? [{type:"attribute",target:"resources.legres.value",value:"1"}]
    : usage.length ? [{type:"itemUses",target:"",value:"1"}]
    : action.activation === "legendary"
      ? [{type:"attribute",target:"resources.legact.value",value:String(action.cost ?? 1)}] : [];
  const activation = {type:action.activation ?? "action",value:action.cost ?? 1,condition:"",override:true};
  const activity = {
    _id:actId,type:action.type ?? "utility",name,img,activation,
    consumption:{spellSlot:false,scaling:{allowed:false},targets:consumption},
    description:{chatFlavor:""},
    duration:{value:"",units:"inst",concentration:false,override:true},
    effects:[],
    range:{value:String(action.range ?? ""),units:action.range ? "ft" : "self",special:"",override:true},
    target:{
      template:{type:action.shape?.[0] ?? "",size:String(action.shape?.[1] ?? ""),width:String(action.shape?.[2] ?? ""),units:"ft",count:""},
      affects:{type:action.type==="utility" || !action.type ? "" : "creature",count:String(action.count ?? (action.type==="attack" ? 1 : "")),choice:false,special:""},
      override:true,prompt:true
    },
    uses:{spent:0,max:"",recovery:[]},
  };
  if(action.type==="attack") {
    activity.attack = {ability:"none",bonus:String(action.hit),flat:true,type:{classification:action.spell?"spell":"weapon",value:action.ranged?"ranged":"melee"}};
    activity.damage = { includeBase:false, parts:action.damage };
  }
  if(action.type==="save") {
    activity.save = {ability:[action.ability],dc:{calculation:"",formula:String(action.dc)}};
    activity.damage = {onSave:"half",parts:action.damage};
  }
  if(action.type==="damage") activity.damage = {parts:action.damage,critical:{allow:false,bonus:""}};
  return {
    _id:itemId,name,img,type:rank===undefined?"feat":"spell",effects:[],sort:(index+1)*100000,
    system:{
      description:{value:"<p>"+action.text+"</p>",chat:""},
      identifier:action.resistance?"legendary-resistance":undefined,
      ...(rank===undefined ? {type:{value:"monster",subtype:""}} : {
        level:rank,method:"innate",school:"evo",properties:["vocal","somatic"],
        activation,range:activity.range,target:activity.target,duration:activity.duration,
      }),
      activities:{[actId]:activity},
      uses:{spent:0,max:usage.length?String(action.limit ?? 1):"",recovery:usage}
    },
  };
}
const actorIds = Object.fromEntries(Object.keys(cast).map(k=>[k,pad("capitalactor"+k)]));
const actors = Object.entries(cast).map(([k,npc])=>{
  const _id = actorIds[k];
  const img = imgFor(npc.img);
  return {
    _id,name:npc.name,img,type:"npc",sort:Object.keys(cast).indexOf(k)*100000,
    flags:{[id]:{emperor:npc.emperor===true}},
    prototypeToken:{
      name:npc.name,texture:{src:img,scaleX:1,scaleY:1},width:1,height:1,actorLink:false,
      sight:{enabled:false},displayName:20,displayBars:20,bar1:{attribute:"attributes.hp"},disposition:-1,
    },
    system:{
      abilities:Object.fromEntries(keyables.map((key,i)=>[key,{value:npc.ability[i],proficient:Number(npc.prof.includes(key))}])),
      attributes:{ac:{flat:npc.ac,calc:"flat"},hp:{value:npc.hp,max:npc.hp,formula:npc.formula},movement:{walk:npc.speed,units:"ft"},senses:{units:"ft"},spellcasting:npc.casting},
      details:{biography:{value:"<p>"+npc.bio+"</p>"},type:{value:npc.emperor?"celestial":"humanoid"},alignment:"",cr:npc.cr},
      traits:{size:npc.size ?? "med",di:{value:npc.immune ?? [],custom:""},languages:{value:["common"],custom:"Имперский"}},
      resources:{legact:{max:npc.legend ?? 0,spent:0},legres:{max:npc.resist ?? 0,spent:0}},
    },
    items:[...npc.actions.map((action,i)=>feature(k,action,i)),...(npc.resist ? [feature(k,{
      name:"Легендарное сопротивление",activation:"special",resistance:true,
      text:"Когда "+npc.name.split(" · ")[0]+" проваливает спасбросок, он может вместо этого преуспеть, потратив одну попытку. Это не требует реакции. "+npc.resist+" попыток в день.",
    },npc.actions.length)] : [])],effects:[],_stats:stats
  };
});
const macroData = [
  ["seal","Развернуть печать","rotateSeal","icons/svg/sun.svg"],
  ["erase","Стереть · объявить / ударить","erase","icons/svg/lightning.svg"],
  ["reset","Покои · сброс арены","reset","icons/svg/clockwork.svg"],
];
const macros = macroData.map(([key,name,fn,img])=>({
  _id:pad("capitalmacro"+key),name,img,type:"script",scope:"global",ownership:{default:0},
  command:"await game.modules.get('imperial-capital').api."+fn+"();",_stats:stats
}));
const pageId = (i) => pad("capitalpage"+i);
const page = (i,name,content,img) => ({
  _id:pageId(i),name,type:"text",title:{show:true,level:1},sort:i*100000,
  text:{format:1,content:(img ? '<p><img src="'+asset("thumbs/"+img+".webp")+'" alt="'+name+'"></p>' : "")+content},
});
const uuid = (type,id,label) => "@UUID["+type+"."+id+"]{"+label+"}";
const p = (phrase) => "<p>"+phrase+"</p>";
const link = (key) => uuid("Scene",ids[key],encounters.find(e=>e.key===key).name);
const macro = (i) => uuid("Macro",macros[i]._id,macros[i].name);
const journal = {
  _id:ids.journal,name:"Императорская столица · журнал ведущего",ownership:{default:0},_stats:stats,
  pages:[
    page(0,"Вход во внутренний город",
      p("Для трёх персонажей 14-го уровня. Внутренние ворота закрываются сразу за группой. До дворца три встречи с императорскими охотниками, по одному противнику на сцене. За дворцом стража ждёт приказа самого Императора.")
      +p("Поставьте токены игроков у южного входа каждой сцены. Порядок перехода: "+encounters.map(e=>link(e.key)).join(" → ")+".")
      +p("Легендарные действия можно использовать по одному в конце чужого хода. Потраченные очки возвращаются в начале хода босса. Включите авторасход ресурсов в Midi-QOL либо подтверждайте расход в диалоге. Атаки, спасброски и урон заведены отдельными активностями. Перемещения, отмену чужих действий, укрытие и сюжетные пороги HP объявляет ведущий.")
      +p("Если вы проводите все пять сцен за один заход, после третьего боя предусмотрен короткий отдых. Если партия почти исчерпала ресурсы после двух встреч, пусть третий охотник пропустит героев после первого ранения и ответа, зачем они идут во дворец."),"avenue"),
    ...encounters.map((e,i)=>page(i+1,e.name,
      "<blockquote>"+p(e.prose)+"</blockquote>"+p(e.gm)+p("Вход группы: колонка "+(e.start[0]+1)+", строка "+(e.start[1]+1)+" от левого верхнего угла.")+p("Сцена — "+link(e.key)+". Противник — "+uuid("Actor",actorIds[e.enemies[0][0]],cast[e.enemies[0][0]].name)+"."),e.key)),
    page(6,"Три печати и «Стереть»",
      finalRules.map(([heading,body])=>"<h2>"+heading+"</h2>"+p(body)).join("")
      +p("Для предупреждения выделите Императора и прицельтесь в один токен клавишей T или выберите направление в диалоге. Запустите "+macro(1)+". На следующем ходу выделите Императора и запустите тот же макрос. Для печати выделите героя и запустите "+macro(0)+". "+macro(2)+" очищает печати и шаблон и восстанавливает Императора.")
      +p("Перед боем в Midi-QOL включите workflow урона, проверку попаданий и спасбросков и выберите удобный режим применения урона к HP. Одноцелевые атаки требуют заранее выбрать цель. Для шаблонов требуются автотаргет Midi-QOL или ручной выбор целей. Для макроса «Стереть» цели отбираются по сохранённому конусу.")
    ),
  ]
};
const bounds = {
  avenue: { previewHeight:650, rects:[[14,15,199,129],[688,15,199,129],[14,215,199,132],[688,215,199,132],[14,433,199,130],[688,433,199,130]] },
  canal: { previewHeight:629, rects:[[24,13,143,93],[359,13,146,93],[737,12,144,94],[24,500,143,94],[359,500,146,94],[737,500,144,94]] },
  court: { previewHeight:687, rects:[[86,269,166,94],[646,269,167,94],[298,196,26,30],[574,196,27,30],[298,449,26,28],[574,449,27,28]] },
  hall: { previewHeight:650, rects:[[179,130,28,28],[179,263,28,28],[179,396,28,28],[179,531,28,28],[692,130,28,28],[692,263,28,28],[692,396,28,28],[692,531,28,28]] },
  throne: { previewHeight:695, rects:[] }
};
function wallsFor(e) {
  const {previewHeight,rects} = bounds[e.key];
  return rects.flatMap(([x,y,w,h],i)=>{
    const points=[[x,y],[x+w,y],[x+w,y+h],[x,y+h]].map(([px,py])=>[
      Math.round(px*e.w/9), Math.round(py*e.h*100/previewHeight)
    ]);
    return points.map(([px,py],j)=>({
      _id:pad(e.key+"wall"+i+"n"+j),c:[px,py,...points[(j+1)%4]],move:20,sight:0,sound:0,light:0,door:0,ds:0,dir:0,
    }));
  });
}
await mkdir("assets/thumbs",{recursive:true});
const scenes = [];
for(const [i,e] of encounters.entries()) {
  await sharp("assets/maps/"+e.key+".webp").resize({width:720}).webp({quality:85}).toFile("assets/thumbs/"+e.key+".webp");
  scenes.push({
    _id:ids[e.key],name:e.name,sort:i*100000,
    thumb:asset("thumbs/"+e.key+".webp"),
    width:e.w*100,height:e.h*100,padding:0,
    background:{src:asset("maps/"+e.key+".webp"),scaleX:1,scaleY:1,offsetX:0,offsetY:0},
    backgroundColor:e.key==="throne"?"#141127":"#37313d",
    grid:{type:1,size:100,distance:5,units:"ft",color:["hall","throne"].includes(e.key)?"#ead3f7":"#3a384c",alpha:0.23,style:"solidLines",thickness:1},
    initial:{x:e.w*50,y:e.h*50,scale:0.28},
    tokenVision:false,fog:{exploration:false},environment:{darknessLevel:0,globalLight:{enabled:true}},
    navigation:true,active:false,journal:ids.journal,journalEntryPage:pageId(i+1),flags:{[id]:{stage:e.key,start:e.start}},
    tokens:e.enemies.map(([key,x,y])=>({
      ...actors.find(a=>a._id===actorIds[key]).prototypeToken,
      _id:pad(e.key+"token"+key),actorId:actorIds[key],x:x*100,y:y*100,hidden:false,rotation:0,
    })),
    lights:[],sounds:[],drawings:[],walls:wallsFor(e),tiles:[],templates:[],notes:[],regions:[],_stats:stats,
  });
}
const adventure = {
  _id:"imperialcapital1",name:"Императорская столица",img:asset("thumbs/avenue.webp"),
  description:p("Пять сцен для трёх персонажей 14-го уровня. Три охотника на магов, варлок Ли Шэнь (CR 20), Император (CR 50), журнал ведущего и три макроса для финала."),
  caption:"Внутренний город, императорский дворец и Бог Молний",
  actors,scenes,journal:[journal],macros,_stats:stats,
};
const packs = [["adventure","Императорская столица · импорт всей главы","Adventure"]];
const repo = "https://github.com/elfurion/imperial-capital";
const manifest = {
  id,title:"Императорская столица",description:p("Глава для трёх персонажей 14-го уровня. Пять карт, три охотника на магов, Страж Императора и Бог Молний."),
  version:"1.0.0",compatibility:{minimum:"13.347",verified:"13.347",maximum:"13"},
  esmodules:["arena.mjs"],
  relationships:{
    systems:[{id:"dnd5e",type:"system",compatibility:{minimum:"5.2.0",verified:"5.2.5",maximum:"5.3.99"}}],
    recommends:[{id:"midi-qol",type:"module",compatibility:{minimum:"13.0.29",maximum:"13.999.999"}}]
  },
  packs:packs.map(([name,label,type])=>({name,label,type,system:"dnd5e",path:"packs/"+name,ownership:{PLAYER:"NONE",TRUSTED:"NONE",ASSISTANT:"OWNER"}})),
  url:repo,manifest:repo+"/releases/latest/download/module.json",
  download:repo+"/releases/download/v1.0.0/imperial-capital.zip",readme:repo+"#readme",
};
await mkdir("build/adventure",{recursive:true});
await mkdir("packs",{recursive:true});
const json = (data) => JSON.stringify(data,null,2)+"\n";
await writeFile("module.json",json(manifest));
await writeFile("build/adventure/imperial-capital.json",json({_key:"!adventures!"+adventure._id,...adventure}));
await compilePack("build/adventure","packs/adventure",{log:true});
