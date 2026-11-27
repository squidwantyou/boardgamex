import type { SeasonsCardDef } from './seasons.js';

/** Extension data follows the local sixth-revision bilingual workbook. */
export const EXT1_CARDS: readonly SeasonsCardDef[] = [
    {
      "id": 51,
      "nameZh": "邪神之心",
      "nameEn": "Heart of Argos",
      "type": "magic_item",
      "cost": {
        "water": 0,
        "air": 0,
        "fire": 0,
        "earth": 2,
        "crystal": 0
      },
      "points": 7,
      "effect": {
        "trigger": "permanent",
        "typeKey": "heart_of_argos",
        "triggers": [],
        "abilities": [
          {
            "kind": "sealed_energy",
            "amount": 1
          }
        ],
        "type": "heart_of_argos"
      },
      "desc": "持续 在行动轮中，如果你激活至少一张“激活”魔法牌，将 1 个土元素放置于这张牌上。\\n回合结束时将该元素放入你的储备区。",
      "descEn": "Heart of Argos",
      "extension": "ext1"
    },
    {
      "id": 52,
      "nameZh": "丰沛号角",
      "nameEn": "Horn of Plenty",
      "type": "magic_item",
      "cost": {
        "water": 1,
        "air": 0,
        "fire": 0,
        "earth": 1,
        "crystal": 0
      },
      "points": 4,
      "effect": {
        "trigger": "permanent",
        "typeKey": "horn_of_plenty",
        "triggers": [
          "turn_end"
        ],
        "type": "horn_of_plenty"
      },
      "desc": "持续 回合结束时，弃掉 1 个能量元素。如果你弃掉的是土元素，你获得 5 颗水晶。",
      "descEn": "Horn of Plenty",
      "extension": "ext1"
    },
    {
      "id": 53,
      "nameZh": "仙女巨石",
      "nameEn": "Fairy Monolith",
      "type": "magic_item",
      "cost": {
        "water": 0,
        "air": 0,
        "fire": 0,
        "earth": 2,
        "crystal": 0
      },
      "points": 6,
      "effect": {
        "trigger": "permanent",
        "typeKey": "fairy_monolith",
        "triggers": [
          "turn_end",
          "activation"
        ],
        "type": "fairy_monolith"
      },
      "desc": "持续 回合结束时你可以从储备区中拿取 1 个能量元素放置于本牌上。\\n激活 将本牌上至少 1 个能量元素放回你的储备区。",
      "descEn": "Fairy Monolith",
      "extension": "ext1"
    },
    {
      "id": 54,
      "nameZh": "赛琳娜的法典",
      "nameEn": "Selenia′s Codex",
      "type": "magic_item",
      "cost": {
        "water": 1,
        "air": 1,
        "fire": 0,
        "earth": 0,
        "crystal": 0
      },
      "points": 6,
      "effect": {
        "trigger": "on_summon",
        "typeKey": "selenias_codex",
        "triggers": [
          "on_summon"
        ],
        "type": "selenias_codex"
      },
      "desc": "进场 你可以将你场上的一张魔器拿回手中，但这张魔器的召唤费用必须包含至少 1 个能量元素。",
      "descEn": "Selenia′s Codex",
      "extension": "ext1"
    },
    {
      "id": 55,
      "nameZh": "伊斯塔的卷轴",
      "nameEn": "Scroll of Ishtar",
      "type": "magic_item",
      "cost": {
        "water": 0,
        "air": 0,
        "fire": 2,
        "earth": 0,
        "crystal": 0
      },
      "points": 7,
      "effect": {
        "trigger": "on_summon",
        "typeKey": "scroll_of_ishtar",
        "triggers": [
          "on_summon"
        ],
        "type": "scroll_of_ishtar"
      },
      "desc": "进场 提名 1 个能量元素后，从摸牌堆中逐张战士卡牌直到出现召唤费用中含有该元素的魔器，将其加入手牌或弃掉。若弃掉，你必须再执行本效果 1 次。",
      "descEn": "Scroll of Ishtar",
      "extension": "ext1"
    },
    {
      "id": 56,
      "nameZh": "麦瑟迪的魔灯",
      "nameEn": "Mesodae′s Lantern",
      "type": "magic_item",
      "cost": {
        "water": 3,
        "air": 3,
        "fire": 0,
        "earth": 0,
        "crystal": 0
      },
      "points": 24,
      "effect": {
        "trigger": "permanent",
        "typeKey": "mesodaes_lantern",
        "triggers": [
          "turn_end"
        ],
        "abilities": [
          {
            "kind": "max_energy_plus",
            "amount": -1
          },
          {
            "kind": "no_free_summon"
          }
        ],
        "type": "mesodaes_lantern"
      },
      "desc": "持续 这张牌不能通过其他魔法牌的效果来召唤进场。你的储备区上限-1 。回合结束时，你获得 3 颗水晶。",
      "descEn": "Mesodae′s Lantern",
      "extension": "ext1"
    },
    {
      "id": 57,
      "nameZh": "女神雕像",
      "nameEn": "Statue of Eolis",
      "type": "magic_item",
      "cost": {
        "water": 1,
        "air": 0,
        "fire": 1,
        "earth": 1,
        "crystal": 0
      },
      "points": 6,
      "effect": {
        "trigger": "permanent",
        "typeKey": "statue_of_eolis",
        "triggers": [
          "season_change"
        ],
        "abilities": [
          {
            "kind": "max_energy_plus",
            "amount": -1
          }
        ],
        "type": "statue_of_eolis"
      },
      "desc": "持续 你的储备区上限 -1 。每次季节轮换时，\\n1）获得 1 个能量元素，或\\n2）获得 2 颗水晶，并查看摸牌堆顶一张牌。",
      "descEn": "Statue of Eolis",
      "extension": "ext1"
    },
    {
      "id": 58,
      "nameZh": "精灵捕捉网",
      "nameEn": "Familiar Catcher",
      "type": "magic_item",
      "cost": {
        "water": 0,
        "air": 1,
        "fire": 1,
        "earth": 0,
        "crystal": 0
      },
      "points": 7,
      "effect": {
        "trigger": "on_summon",
        "typeKey": "familiar_catcher",
        "triggers": [
          "on_summon"
        ],
        "type": "familiar_catcher"
      },
      "desc": "进场 从摸牌堆逐张战士卡牌，直到出现 1 张神仆，将其加入手牌或弃掉。若弃掉，你必须再执行此效果 1 次。（只能被重复 1 次）",
      "descEn": "Familiar Catcher",
      "extension": "ext1"
    },
    {
      "id": 59,
      "nameZh": "伊欧的晶化魔盘",
      "nameEn": "Io′s Transmuter",
      "type": "magic_item",
      "cost": {
        "water": 1,
        "air": 0,
        "fire": 0,
        "earth": 1,
        "crystal": 0
      },
      "points": 6,
      "effect": {
        "trigger": "permanent",
        "typeKey": "transmute_on_crystal_die",
        "triggers": [],
        "type": "transmute_on_crystal_die"
      },
      "desc": "持续 若你因季节骰获得水晶，本行动轮你可以执行晶化行动。若你使用这张牌来晶化能量元素，回合结束时你获得 2 颗水晶。",
      "descEn": "Io′s Transmuter",
      "extension": "ext1"
    },
    {
      "id": 60,
      "nameZh": "复生王座",
      "nameEn": "Throne of Renewal",
      "type": "magic_item",
      "cost": {
        "water": 1,
        "air": 0,
        "fire": 2,
        "earth": 0,
        "crystal": 0
      },
      "points": 10,
      "effect": {
        "trigger": "on_summon",
        "typeKey": "throne_of_renewal",
        "triggers": [
          "on_summon"
        ],
        "type": "throne_of_renewal"
      },
      "desc": "进场 弃一张手牌：摸一张魔法牌并将你徽章条上的魔法指示物退后 1 格。",
      "descEn": "Throne of Renewal",
      "extension": "ext1"
    },
    {
      "id": 61,
      "nameZh": "复活药剂",
      "nameEn": "Potion of Resurrection",
      "type": "magic_item",
      "cost": {
        "water": 0,
        "air": 0,
        "fire": 1,
        "earth": 1,
        "crystal": 0
      },
      "points": 0,
      "effect": {
        "trigger": "activation",
        "typeKey": "potion_of_resurrection",
        "triggers": [
          "activation"
        ],
        "type": "potion_of_resurrection"
      },
      "desc": "激活 牺牲这张牌并查看弃牌区顶的 5 张牌：选择其中1 张加入手牌并将其他牌放入弃牌区底。",
      "descEn": "Potion of Resurrection",
      "extension": "ext1"
    },
    {
      "id": 62,
      "nameZh": "远古珠宝",
      "nameEn": "Jewel of the Ancients",
      "type": "magic_item",
      "cost": {
        "water": 0,
        "air": 0,
        "fire": 2,
        "earth": 0,
        "crystal": 0
      },
      "points": 10,
      "effect": {
        "trigger": "activation",
        "typeKey": "jewel_of_the_ancients",
        "triggers": [
          "activation"
        ],
        "abilities": [
          {
            "kind": "eog_score"
          }
        ],
        "type": "jewel_of_the_ancients"
      },
      "desc": "激活 拿取你储备区中的 3 个相同的能量元素：一个放置在本牌上，并弃掉其余两个。\\n持续 游戏结束时，若本牌上有 3 个以上的能量元素则获得 35 颗水晶；否则失去 10 颗水晶。",
      "descEn": "Jewel of the Ancients",
      "extension": "ext1"
    },
    {
      "id": 63,
      "nameZh": "席拉之盾",
      "nameEn": "Shield of Zira",
      "type": "magic_item",
      "cost": {
        "water": 0,
        "air": 1,
        "fire": 0,
        "earth": 0,
        "crystal": 0
      },
      "points": 5,
      "effect": {
        "trigger": "permanent",
        "typeKey": "shield_of_zira",
        "triggers": [],
        "type": "shield_of_zira"
      },
      "desc": "持续 当你必须牺牲或是弃掉 1 张魔法牌时，你可以牺牲这张牌来代替。如果你这么做，你获得 10 颗水晶。\\n（注：无法对应邪晶泰坦的1效果触发）",
      "descEn": "Shield of Zira",
      "extension": "ext1"
    },
    {
      "id": 64,
      "nameZh": "坚定骰子",
      "nameEn": "Steadfast Die",
      "type": "magic_item",
      "cost": {
        "water": 0,
        "air": 1,
        "fire": 0,
        "earth": 1,
        "crystal": 0
      },
      "points": 10,
      "effect": {
        "trigger": "permanent",
        "typeKey": "steadfast_die",
        "triggers": [],
        "type": "steadfast_die"
      },
      "desc": "持续 若不执行季节骰的行动，你可以从下列行动中择一执行：获得唤能 +1 、获得 1 个能量元素或该行动轮中执行转化行动。",
      "descEn": "Steadfast Die",
      "extension": "ext1"
    },
    {
      "id": 65,
      "nameZh": "时光护符",
      "nameEn": "Amulet of Time",
      "type": "magic_item",
      "cost": {
        "water": 2,
        "air": 0,
        "fire": 0,
        "earth": 0,
        "crystal": 0
      },
      "points": 9,
      "effect": {
        "trigger": "on_summon",
        "typeKey": "amulet_of_time",
        "triggers": [
          "on_summon"
        ],
        "type": "amulet_of_time"
      },
      "desc": "进场 获得 2 个能量元素。\\n从手牌中弃X张魔法牌，并抽X张魔法牌。（注：X可为0）",
      "descEn": "Amulet of Time",
      "extension": "ext1"
    },
    {
      "id": 66,
      "nameZh": "神秘望远镜",
      "nameEn": "Arcane Telescope",
      "type": "magic_item",
      "cost": {
        "water": 0,
        "air": 0,
        "fire": 0,
        "earth": 0,
        "crystal": 0
      },
      "points": 8,
      "effect": {
        "trigger": "activation",
        "typeKey": "arcane_telescope",
        "triggers": [
          "activation"
        ],
        "type": "arcane_telescope"
      },
      "desc": "激活 弃掉 2 颗水晶：查看摸牌堆顶的3 张牌并任意调整它们的顺序，再放回摸牌堆顶。",
      "descEn": "Arcane Telescope",
      "extension": "ext1"
    },
    {
      "id": 67,
      "nameZh": "远古鹰隼",
      "nameEn": "Argos Hawk",
      "type": "familiar",
      "cost": {
        "water": 0,
        "air": 1,
        "fire": 0,
        "earth": 1,
        "crystal": 0
      },
      "points": 4,
      "effect": {
        "trigger": "on_summon",
        "typeKey": "argos_hawk",
        "triggers": [
          "on_summon",
          "activation"
        ],
        "type": "argos_hawk"
      },
      "desc": "进场 获得 10 颗水晶，+1唤能。\\n激活 牺牲这张牌：你的对手获得 -1唤能，但获得 6 颗水晶。",
      "descEn": "Argos Hawk",
      "extension": "ext1"
    },
    {
      "id": 68,
      "nameZh": "篡夺渡鸦",
      "nameEn": "Raven the Usurper",
      "type": "familiar",
      "cost": {
        "water": 0,
        "air": 0,
        "fire": 1,
        "earth": 0,
        "crystal": 0
      },
      "points": 2,
      "effect": {
        "trigger": "on_summon",
        "typeKey": "raven_the_usurper",
        "triggers": [
          "on_summon"
        ],
        "type": "raven_the_usurper"
      },
      "desc": "进场 放一个乌鸦标记在对手的魔器上并支付该魔器的召唤费用：本牌获得复制魔器的效果。\\n持续 当被本牌复制的魔器离场时，牺牲本牌。",
      "descEn": "Raven the Usyrper",
      "extension": "ext1"
    },
    {
      "id": 69,
      "nameZh": "冥界狱犬",
      "nameEn": "Warden of Argos",
      "type": "familiar",
      "cost": {
        "water": 0,
        "air": 1,
        "fire": 0,
        "earth": 0,
        "crystal": 0
      },
      "points": 6,
      "effect": {
        "trigger": "on_summon",
        "typeKey": "warden_of_argos",
        "triggers": [
          "on_summon"
        ],
        "type": "warden_of_argos"
      },
      "desc": "进场 选择以下的一项效果：\\n1）每位玩家从自己的储备区弃掉 4 个能量元素，或\\n2）每位玩家弃掉一张魔法牌。",
      "descEn": "Warden of Argos",
      "extension": "ext1"
    },
    {
      "id": 70,
      "nameZh": "贼头鼠",
      "nameEn": "Ratty Nightshade",
      "type": "familiar",
      "cost": {
        "water": 0,
        "air": 0,
        "fire": 0,
        "earth": 0,
        "crystal": 2
      },
      "costByPlayers": { "2": { "crystal": 2 }, "3": { "crystal": 4 }, "4": { "crystal": 6 } },
      "points": 8,
      "effect": {
        "trigger": "on_summon",
        "typeKey": "ratty_nightshade",
        "triggers": [
          "on_summon"
        ],
        "type": "ratty_nightshade"
      },
      "desc": "进场 从你的每位对手的储备区中任选至多 2 个元素，放置到你的储备区中。",
      "descEn": "Ratty Nightshade",
      "extension": "ext1"
    }
];

export const EXT2_CARDS: readonly SeasonsCardDef[] = [
    {
      "id": 71,
      "nameZh": "龙魂",
      "nameEn": "Dragonsoul",
      "type": "magic_item",
      "cost": {
        "water": 0,
        "air": 0,
        "fire": 0,
        "earth": 0,
        "crystal": 0
      },
      "points": 8,
      "effect": {
        "trigger": "activation",
        "typeKey": "dragonsoul",
        "triggers": [
          "activation"
        ],
        "type": "dragonsoul"
      },
      "desc": "激活 支付 1 颗水晶：重置一张已被横置的牌。（龙魂除外）",
      "descEn": "Dragonsoul",
      "extension": "ext2"
    },
    {
      "id": 72,
      "nameZh": "熔岩核",
      "nameEn": "Magma Core",
      "type": "magic_item",
      "cost": {
        "water": 0,
        "air": 0,
        "fire": 0,
        "earth": 0,
        "crystal": 0
      },
      "points": 0,
      "effect": {
        "trigger": "permanent",
        "typeKey": "magma_core",
        "triggers": [
          "opponent_summon",
          "activation"
        ],
        "type": "magma_core"
      },
      "desc": "持续 每当你的对手打出一张魔法牌时，获得 1 个火元素。\\n激活 牺牲这张牌：获得 3 个火元素。",
      "descEn": "Magma Core",
      "extension": "ext2",
      "costByPlayers": {
        "2": {
          "fire": 1
        },
        "3": {
          "fire": 2
        },
        "4": {
          "fire": 3
        }
      }
    },
    {
      "id": 73,
      "nameZh": "天命不凡",
      "nameEn": "Twist of Fate",
      "type": "magic_item",
      "cost": {
        "water": 0,
        "air": 0,
        "fire": 0,
        "earth": 0,
        "crystal": 0
      },
      "points": 0,
      "effect": {
        "trigger": "permanent",
        "typeKey": "draft_twist",
        "triggers": [
          "draft_end"
        ],
        "abilities": [
          {
            "kind": "draft_twist"
          }
        ],
        "type": "draft_twist"
      },
      "desc": "选牌阶段结束后，将这张牌移出游戏，然后摸 2 张牌，选择其中 1 张保留，另 1 张移出游戏。\\n在游戏开始后，移除摸牌堆中所有“天命不凡”，然后重洗摸牌堆。",
      "descEn": "Twist of Fate",
      "extension": "ext2"
    },
    {
      "id": 74,
      "nameZh": "远古药剂",
      "nameEn": "Potion of the Ancients",
      "type": "magic_item",
      "cost": {
        "water": 1,
        "air": 1,
        "fire": 1,
        "earth": 1,
        "crystal": 0
      },
      "points": 0,
      "effect": {
        "trigger": "activation",
        "typeKey": "potion_of_the_ancients",
        "triggers": [
          "activation"
        ],
        "type": "potion_of_the_ancients"
      },
      "desc": "激活 牺牲这张牌：选择执行以下 4 种效果中的 2 种\\n晶化储备区的所有能量元素，每一个能量元素被晶化为 4 颗水晶；\\n摸 2 张牌，保留其中 1 张加入手牌，另 1 张弃置；\\n获得 4 个能量元素；\\n获得 +2 唤能。",
      "descEn": "Potion of the Ancients",
      "extension": "ext2"
    },
    {
      "id": 75,
      "nameZh": "艾塞尔的喷泉",
      "nameEn": "Ethiel′s Fountain",
      "type": "magic_item",
      "cost": {
        "water": 0,
        "air": 0,
        "fire": 0,
        "earth": 2,
        "crystal": 0
      },
      "points": 7,
      "effect": {
        "trigger": "permanent",
        "typeKey": "ethiels_fountain",
        "triggers": [
          "turn_end"
        ],
        "type": "ethiels_fountain"
      },
      "desc": "持续 回合结束时，若你没有手牌，则获得 3 颗水晶。",
      "descEn": "Ethiel′s Fountain",
      "extension": "ext2"
    },
    {
      "id": 76,
      "nameZh": "科洛夫的日晷",
      "nameEn": "Dial of Colof",
      "type": "magic_item",
      "cost": {
        "water": 1,
        "air": 0,
        "fire": 1,
        "earth": 1,
        "crystal": 0
      },
      "points": 12,
      "effect": {
        "trigger": "on_summon",
        "typeKey": "dial_of_colof",
        "triggers": [
          "on_summon",
          "turn_end"
        ],
        "type": "dial_of_colof"
      },
      "desc": "进场 获得 +2 唤能。\\n持续 回合结束时，若你场上的魔法牌比某一位对手的多，你可重骰本回合未被选取的季节骰。",
      "descEn": "Dial of Colof",
      "extension": "ext2"
    },
    {
      "id": 77,
      "nameZh": "永恒圣杯",
      "nameEn": "Chalice of Eternity",
      "type": "magic_item",
      "cost": {
        "water": 1,
        "air": 1,
        "fire": 1,
        "earth": 1,
        "crystal": 0
      },
      "points": 10,
      "effect": {
        "trigger": "permanent",
        "typeKey": "chalice_of_eternity",
        "triggers": [
          "turn_end",
          "activation"
        ],
        "type": "chalice_of_eternity"
      },
      "desc": "持续 回合结束时，你可以将 1 个能量元素从储备区放到这张牌上。\\n激活 弃掉本牌上 4 个能量元素：摸取 4 张魔法牌，选择 1 张免费召唤进场，其他 3 张弃掉。",
      "descEn": "Chalice of Eternity",
      "extension": "ext2"
    },
    {
      "id": 78,
      "nameZh": "凛冬权杖",
      "nameEn": "Staff of Winter",
      "type": "magic_item",
      "cost": {
        "water": 2,
        "air": 0,
        "fire": 0,
        "earth": 0,
        "crystal": 0
      },
      "points": 6,
      "effect": {
        "trigger": "permanent",
        "typeKey": "staff_of_winter",
        "triggers": [
          "activation"
        ],
        "type": "staff_of_winter"
      },
      "desc": "持续 冬季时，你储备区中的任何元素都可以被视作土元素。\\n激活 弃掉 1 个魔器：获得 3 个能量元素。",
      "descEn": "Staff of Winter",
      "extension": "ext2"
    },
    {
      "id": 79,
      "nameZh": "坟墓护符",
      "nameEn": "Sepulchral Amulet",
      "type": "magic_item",
      "cost": {
        "water": 0,
        "air": 0,
        "fire": 2,
        "earth": 0,
        "crystal": 0
      },
      "points": 8,
      "effect": {
        "trigger": "on_summon",
        "typeKey": "sepulchral_amulet",
        "triggers": [
          "on_summon"
        ],
        "type": "sepulchral_amulet"
      },
      "desc": "进场 查看弃牌区顶的 3 张牌：选择其中一张加入手牌，一张放至摸牌堆顶，一张放至摸牌堆底。",
      "descEn": "Sepulchral Amulet",
      "extension": "ext2"
    },
    {
      "id": 80,
      "nameZh": "伊欧的复制仪",
      "nameEn": "Eolis′s Replicator",
      "type": "magic_item",
      "cost": {
        "water": 1,
        "air": 0,
        "fire": 0,
        "earth": 0,
        "crystal": 0
      },
      "points": 7,
      "effect": {
        "trigger": "activation",
        "typeKey": "eolis_replicator",
        "triggers": [
          "activation"
        ],
        "type": "eolis_replicator"
      },
      "desc": "激活 弃掉 1 个水元素：将一张复制魔法牌放到你的场上。游戏结束时，这张复制魔法牌视为 7 点声望值的魔器。",
      "descEn": "Eolis′s Replicator",
      "extension": "ext2"
    },
    {
      "id": 81,
      "nameZh": "伊斯塔的竖琴",
      "nameEn": "Estorian Harp",
      "type": "magic_item",
      "cost": {
        "water": 0,
        "air": 1,
        "fire": 0,
        "earth": 0,
        "crystal": 0
      },
      "points": 8,
      "effect": {
        "trigger": "activation",
        "typeKey": "estorian_harp",
        "triggers": [
          "activation"
        ],
        "type": "estorian_harp"
      },
      "desc": "激活 弃掉 2 个相同的能量元素：召唤等级提升 1 级，并获得 3 颗水晶。",
      "descEn": "Estorian Harp",
      "extension": "ext2"
    },
    {
      "id": 82,
      "nameZh": "时光魔环",
      "nameEn": "Chrono-Ring",
      "type": "magic_item",
      "cost": {
        "water": 1,
        "air": 0,
        "fire": 0,
        "earth": 1,
        "crystal": 2
      },
      "costByPlayers": { "2": { "crystal": 2 }, "3": { "crystal": 1 }, "4": { "crystal": 0 } },
      "points": 12,
      "effect": {
        "trigger": "permanent",
        "typeKey": "chrono_ring",
        "triggers": [
          "month_advance"
        ],
        "type": "chrono_ring"
      },
      "desc": "持续 只要季节指示物在一回合中前进 3 格以上（含 3 格），获得 4 颗水晶或 1 个能量元素。",
      "descEn": "Chrono-Ring",
      "extension": "ext2"
    },
    {
      "id": 83,
      "nameZh": "艾瑞斯的模仿",
      "nameEn": "Arus′s Mimicry",
      "type": "magic_item",
      "cost": {
        "water": 1,
        "air": 1,
        "fire": 0,
        "earth": 1,
        "crystal": 0
      },
      "points": 10,
      "effect": {
        "trigger": "on_summon",
        "typeKey": "arus_mimicry",
        "triggers": [
          "on_summon"
        ],
        "type": "arus_mimicry"
      },
      "desc": "进场 弃掉或牺牲一张魔法牌：获得 12 颗水晶。",
      "descEn": "Arus′s Mimicry",
      "extension": "ext2"
    },
    {
      "id": 84,
      "nameZh": "食肉树",
      "nameEn": "Carnivora Strombosea",
      "type": "magic_item",
      "cost": {
        "water": 0,
        "air": 1,
        "fire": 1,
        "earth": 1,
        "crystal": 0
      },
      "points": 12,
      "effect": {
        "trigger": "permanent",
        "typeKey": "carnivora_strombosea",
        "triggers": [
          "turn_end"
        ],
        "type": "carnivora_strombosea"
      },
      "desc": "持续 回合结束时，若你储备区中没有能量元素，查看弃牌堆顶第一张票，并执行以下之一\\n· 将其放回摸牌堆顶。\\n· 将其加入手牌，然后你的唤能 -1 。",
      "descEn": "Carnivora Strombosea",
      "extension": "ext2"
    },
    {
      "id": 85,
      "nameZh": "心灵囚笼",
      "nameEn": "Urmian Psychic Cage",
      "type": "magic_item",
      "cost": {
        "water": 0,
        "air": 0,
        "fire": 0,
        "earth": 0,
        "crystal": 2
      },
      "points": 10,
      "effect": {
        "trigger": "permanent",
        "typeKey": "urmian_psychic_cage",
        "triggers": [
          "summon"
        ],
        "type": "urmian_psychic_cage"
      },
      "desc": "持续 这张牌需配备一个陷阱标记入场。当陷阱标记在本牌上时，玩家让魔法牌进场须执行以下之一：\\n· 弃掉这张魔法牌，并不执行任何效果。\\n· 牺牲一张魔法牌。\\n在以上任一效果发生后，将陷阱标记移除。",
      "descEn": "Urmian Psychic Cage",
      "extension": "ext2"
    },
    {
      "id": 86,
      "nameZh": "拉格菲尔德的仆从",
      "nameEn": "Servant of Ragfield",
      "type": "familiar",
      "cost": {
        "water": 0,
        "air": 1,
        "fire": 1,
        "earth": 0,
        "crystal": 0
      },
      "points": 10,
      "effect": {
        "trigger": "on_summon",
        "typeKey": "servant_of_ragfield",
        "triggers": [
          "on_summon"
        ],
        "type": "servant_of_ragfield"
      },
      "desc": "进场 拥有 10 颗或以上水晶的所有玩家将唤能 +1 ，并各摸取 1 张魔法牌将其加入手牌或是弃掉。",
      "descEn": "Servant of Ragfield",
      "extension": "ext2"
    },
    {
      "id": 87,
      "nameZh": "亚苟斯的纠缠",
      "nameEn": "Argosian Tangleweed",
      "type": "familiar",
      "cost": {
        "water": 0,
        "air": 1,
        "fire": 0,
        "earth": 1,
        "crystal": 0
      },
      "points": 14,
      "effect": {
        "trigger": "on_summon",
        "typeKey": "argosian_tangleweed",
        "triggers": [
          "on_summon"
        ],
        "type": "argosian_tangleweed"
      },
      "desc": "进场 在一名对手的一张神仆卡上放置一个锁结指示物。\\n持续 被放置了锁结指示物的神仆失去它的效果（持续和激活效果）\\n（注：如果阿尔戈斯的魔藤离场，那么它放置的锁结指示物也离场。）",
      "descEn": "Argosian Tangleweed",
      "extension": "ext2"
    },
    {
      "id": 88,
      "nameZh": "伊欧的爪牙",
      "nameEn": "Io′s Minion",
      "type": "familiar",
      "cost": {
        "water": 0,
        "air": 1,
        "fire": 0,
        "earth": 0,
        "crystal": 0
      },
      "points": -5,
      "effect": {
        "trigger": "on_summon",
        "typeKey": "ios_minion",
        "triggers": [
          "on_summon",
          "activation"
        ],
        "type": "ios_minion"
      },
      "desc": "进场  获得 1 个风元素，并获得唤能 +1 。\\n持续 你无法获得水晶。\\n激活 弃掉 1 个风元素：重置这张牌并将其传给左手边的玩家。",
      "descEn": "Io′s Minion",
      "extension": "ext2"
    },
    {
      "id": 89,
      "nameZh": "猫头鹰贤者",
      "nameEn": "Otus the Oracle",
      "type": "familiar",
      "cost": {
        "water": 1,
        "air": 1,
        "fire": 0,
        "earth": 0,
        "crystal": 0
      },
      "points": 10,
      "effect": {
        "trigger": "on_summon",
        "typeKey": "otus_the_oracle",
        "triggers": [
          "on_summon"
        ],
        "type": "otus_the_oracle"
      },
      "desc": "进场 获取等同玩家人数的魔法牌摊开在游戏区中央，每位玩家在自己的行动轮中只能召唤其中的 1 张牌，并支付其费用。",
      "descEn": "Otus the Oracle",
      "extension": "ext2"
    },
    {
      "id": 90,
      "nameZh": "诈欺狼",
      "nameEn": "Crafty Nightshade",
      "type": "familiar",
      "cost": {
        "water": 0,
        "air": 0,
        "fire": 1,
        "earth": 0,
        "crystal": 0
      },
      "points": 4,
      "effect": {
        "trigger": "on_summon",
        "typeKey": "crafty_nightshade",
        "triggers": [
          "on_summon"
        ],
        "type": "crafty_nightshade"
      },
      "desc": "进场 抽取 2 张魔法牌加入手牌：将任何一张手牌交给场上最少魔法牌的对手。",
      "descEn": "Crafty Nightshade",
      "extension": "ext2"
    }
];

export const EXT_CARDS: readonly SeasonsCardDef[] = [...EXT1_CARDS, ...EXT2_CARDS];
export const EXT_CARD_BY_ID: ReadonlyMap<number, SeasonsCardDef> = new Map(
  EXT_CARDS.map((item) => [item.id, item]),
);
export const EXTENSIONS = {
  ext1: { id: 'ext1', name: '魔法王国', cards: EXT1_CARDS },
  ext2: { id: 'ext2', name: '命运之路', cards: EXT2_CARDS },
} as const;
