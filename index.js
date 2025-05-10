import { GoogleGenAI } from '@google/genai';
require('dotenv').config();

const { Client, GatewayIntentBits, Events } = require('discord.js');
const fs = require('fs');

// Create a new client instance with necessary intents
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions
    ],
    partials: ['MESSAGE', 'CHANNEL', 'REACTION'] // Needed for raw events
});

// Path to save divineCounts data
const divineCountsPath = 'divineCounts.json';

// Initialize divineCounts from file if it exists
let divineCounts = {};
if (fs.existsSync(divineCountsPath)) {
    try {
        divineCounts = JSON.parse(fs.readFileSync(divineCountsPath, 'utf8'));
    } catch (error) {
        console.error('Error reading divineCounts.json:', error);
    }
}

// Define chances and stack settings
const dropChance = 0.01;
const enemyChance = 0.9;
const bossChance = 0.1;
const enemyDropChance = 0.10;
const bossDropChance = 0.25;
const stackChance = 0.01;
const divineEmoji = '<:divine:1278151900981624926>';
const attackEmoji = '⚔️';
const strongAttackEmoji = '💥';
const ultimateAttackEmoji = '🌟';
const strongAttackCost = 1; // Cost for strong attack
const ultimateAttackCost = 5; // Cost for ultimate attack

// List of enemy names
const enemies = ['Rhoa', 'Cannibal', 'Goatman', 'Crab', 'Skeleton', 'Zombie', 'Drowned'];
const bosses = ['Brine King'];

// Function to get a random enemy or boss name
function getRandomName(namesArray) {
    const randomIndex = Math.floor(Math.random() * namesArray.length);
    return namesArray[randomIndex];
}

// Function to determine stack size based on weighted probabilities
function getStackSize() {
    const roll = Math.random();
    if (roll < 0.1) return 5; // 10% chance for stack size 5
    if (roll < 0.3) return 4; // 20% chance for stack size 4
    if (roll < 0.6) return 3; // 30% chance for stack size 3
    return 2; // 40% chance for stack size 2
}

// Function to determine the chance to drop 100 divines
function checkDrop100Divines(attackCost) {
    if (attackCost === strongAttackCost) {
        return Math.random() < 0.00001; // 0.001% chance for strong attack
    } else if (attackCost === ultimateAttackCost) {
        return Math.random() < 0.00006; // 0.006% chance for ultimate attack
    }
    return false;
}

// Initialize a map to keep track of encounter messages, users who reacted, and the initiator
const encounterData = new Map();

// Event listener for when the client is ready
client.once(Events.ClientReady, () => {
    console.log(`Logged in as ${client.user.tag}`);
});

// Event listener for new messages
client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;

    console.log(`Received message: ${message.content}`);

    // Handle the "!stash" command
    if (message.content.startsWith('!stash')) {
        const userId = message.author.id;
        const divines = divineCounts[userId] || 0;
        message.channel.send(`${message.author}, you have ${divines} ${divineEmoji}.`);
        return;
    }

    // Handle the "!leaderboard" command
    if (message.content.startsWith('!leaderboard')) {
        const sortedUsers = Object.entries(divineCounts)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 10); // Get top 10 users

        const leaderboard = sortedUsers.map(([userId, count], index) => 
            `#${index + 1} <@${userId}>: ${count} ${divineEmoji}`
        ).join('\n');

        message.channel.send(`**Leaderboard:**\n${leaderboard}`);
        return;
    }

    // Handle the chance of encountering an enemy or boss
    if (Math.random() < dropChance) {
        const userId = message.author.id;
        const encounter = Math.random();

        // Determine if it's an enemy or boss encounter
        let encounterType;
        let encounterName;

        if (encounter < enemyChance) {
            encounterType = 'enemy';
            encounterName = getRandomName(enemies);
        } else if (encounter < enemyChance + bossChance) {
            encounterType = 'boss';
            encounterName = getRandomName(bosses);
        }

        // Send a message with reaction options
        const encounterMessage = encounterType === 'enemy' ?
            `${message.author}, you encounter a ${encounterName}! React with ${attackEmoji} to attack.` :
            `${message.author}, you encounter ${encounterName}! React with ${attackEmoji} to attack, ${strongAttackEmoji} for a strong attack, or ${ultimateAttackEmoji} for an ultimate attack.`;

        const sentMessage = await message.channel.send(encounterMessage);
        await sentMessage.react(attackEmoji);
        await sentMessage.react(strongAttackEmoji);
        await sentMessage.react(ultimateAttackEmoji);

        // Track the encounter message ID, users who reacted, and the initiator
        encounterData.set(sentMessage.id, {
            initiatorId: userId,
            usersReacted: new Set()
        });
    }
});

// Handle raw message reactions
client.on(Events.Raw, async (event) => {
    if (event.t === 'MESSAGE_REACTION_ADD' || event.t === 'MESSAGE_REACTION_REMOVE') {
        const { d: data } = event;
        const channel = await client.channels.fetch(data.channel_id);
        const message = await channel.messages.fetch(data.message_id);
        const user = await client.users.fetch(data.user_id);
        
        if (user.bot) return;

        const emojiName = data.emoji.name;

        if (message.author.id !== client.user.id) return;

        if (message.content.includes('encounter')) {
            const encounter = encounterData.get(message.id);

            if (!encounter) return;

            // Check if the user reacting is the initiator
            if (encounter.initiatorId !== user.id) {
                message.channel.send(`${user}, only the person who started the encounter can interact with it.`);
                return;
            }

            // Check if the user has already reacted to this encounter
            if (encounter.usersReacted.has(user.id)) {
                message.channel.send(`${user}, you have already reacted to this encounter.`);
                return;
            }

            // Mark the user as having reacted
            encounter.usersReacted.add(user.id);

            let attackCost = 0;
            let rewardMultiplier = 1;

            if (emojiName === strongAttackEmoji) {
                attackCost = strongAttackCost;
                rewardMultiplier = 5; // Strong attack multiplier
            } else if (emojiName === ultimateAttackEmoji) {
                attackCost = ultimateAttackCost;
                rewardMultiplier = 10; // Ultimate attack multiplier
            }

            // Deduct divines based on attack cost
            const userDivines = divineCounts[user.id] || 0;
            if (userDivines < attackCost && (emojiName === strongAttackEmoji || emojiName === ultimateAttackEmoji)) {
                message.channel.send(`${user}, you don't have enough ${divineEmoji} to perform this attack.`);
                return;
            }

            // Deduct the attack cost
            if (emojiName === strongAttackEmoji || emojiName === ultimateAttackEmoji) {
                divineCounts[user.id] = (divineCounts[user.id] || 0) - attackCost;
                fs.writeFileSync(divineCountsPath, JSON.stringify(divineCounts, null, 2));
            }

            if (emojiName === attackEmoji || emojiName === strongAttackEmoji || emojiName === ultimateAttackEmoji) {
                if (checkDrop100Divines(attackCost)) {
                    divineCounts[user.id] = (divineCounts[user.id] || 0) + 100 * rewardMultiplier;
                    message.channel.send(`${user}, wowee that's a big boy! You found 100 ${divineEmoji} from your attack. You now have ${divineCounts[user.id]} ${divineEmoji}.`);
                } else {
                    if (Math.random() < enemyDropChance) {
                        if (Math.random() < stackChance) {
                            const stackSize = getStackSize();
                            divineCounts[user.id] = (divineCounts[user.id] || 0) + stackSize * rewardMultiplier;
                            message.channel.send(`${user}, you defeated the enemy and found a stack of ${stackSize} ${divineEmoji}! You now have ${divineCounts[user.id]} ${divineEmoji}.`);
                        } else {
                            divineCounts[user.id] = (divineCounts[user.id] || 0) + rewardMultiplier;
                            message.channel.send(`${user}, you defeated the enemy and found ${rewardMultiplier} ${divineEmoji}! You now have ${divineCounts[user.id]} ${divineEmoji}.`);
                        }
                    } else {
                        message.channel.send(`${user}, you fought bravely but found no ${divineEmoji}.`);
                    }
                }
                fs.writeFileSync(divineCountsPath, JSON.stringify(divineCounts, null, 2));
            }

            // Remove the encounter from the map after handling the reaction
            encounterData.delete(message.id);
        }
    }
});

// Messaging the Brine King
/*
client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;

    if (message.mentions.has(client.user)) {
        message.reply('Hey bbg')
    }
}
    */

// Replace with your actual bot token
const key = process.env.KEY;
client.login(key);
