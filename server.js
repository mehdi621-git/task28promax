const express = require('express');
const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");
const { S3Client, PutObjectCommand, ListObjectsV2Command, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const app = express();
const port = 3000;

const secretsClient = new SecretsManagerClient({ region: "eu-west-1" });
const s3Client = new S3Client({ region: "eu-west-1" });

async function getSecrets() {
    const response = await secretsClient.send(new GetSecretValueCommand({ SecretId: "frontend-config" }));
    return JSON.parse(response.SecretString);
}

// 1. Endpoint to generate a upload link
app.get('/get-upload-url', async (req, res) => {
    try {
        const secrets = await getSecrets();
        const fileName = `${Date.now()}-${req.query.filename}`;
        
        const command = new PutObjectCommand({
            Bucket: secrets.BUCKET_NAME,
            Key: fileName,
            ContentType: req.query.contentType || 'image/jpeg', // ← add this
        });

        const uploadUrl = await getSignedUrl(s3Client, command, { 
            expiresIn: 3600,
            unhoistableHeaders: new Set(), // ← prevents checksum headers
        });

        res.json({ uploadUrl, fileName });
    } catch (err) {
        res.status(500).send(err.message);
    }
});

// 2. NEW ENDPOINT: Lists images from S3 and generates temporary view links
app.get('/list-images', async (req, res) => {
    try {
        const secrets = await getSecrets();
        
        // Fetch list of objects from S3
        const listCommand = new ListObjectsV2Command({
            Bucket: secrets.BUCKET_NAME
        });
        const s3Data = await s3Client.send(listCommand);

        if (!s3Data.Contents) {
            return res.json([]);
        }

        // Generate a secure, temporary view URL for each file found
        const imageUrls = await Promise.all(
            s3Data.Contents.map(async (file) => {
                const getCommand = new GetObjectCommand({
                    Bucket: secrets.BUCKET_NAME,
                    Key: file.Key
                });
                return await getSignedUrl(s3Client, getCommand, { expiresIn: 3600 });
            })
        );

        res.json(imageUrls);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

app.use(express.static('public'));
app.listen(port, () => console.log(`Server running on port ${port}`));
