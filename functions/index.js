const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { setGlobalOptions, logger } = require("firebase-functions/v2");
const admin = require("firebase-admin");

admin.initializeApp();
setGlobalOptions({ maxInstances: 10 });

exports.sendPostNotificationToFollowers = onDocumentCreated(
  "posts_summary/{postId}",
  async (event) => {
    const postData = event.data.data();
    const postId = event.params.postId;

    if (!postData) {
      logger.warn(`No post data found for postId: ${postId}`);
      return;
    }

    const {
      title,
      category,
      authorName,
      uid,
      createdAt,
      numLikes,
      numComments,
      preview,
    } = postData;

    const summary = {
      postId,
      title,
      category,
      authorName,
      uid,
      createdAt,
      preview,
    };

    logger.info(
      `New post published by ${authorName}: "${title}" in ${category}`,
    );

    try {
      const followersSnapshot = await admin
        .firestore()
        .collection("users")
        .doc(uid)
        .collection("followers")
        .get();

      const followerTokens = [];

      for (const doc of followersSnapshot.docs) {
        const follower = doc.data();
        const followerId = follower.followerId;

        // Save notification in Firestore
        await admin
          .firestore()
          .collection("users")
          .doc(followerId)
          .collection("notifications")
          .add({
            postId,
            title,
            authorName,
            preview,
            createdAt: admin.firestore.Timestamp.now(),
            isRead: false,
            type: "new_post", // optional for filtering
          });

        // Fetch FCM token for push notification
        const followerDoc = await admin
          .firestore()
          .collection("users")
          .doc(followerId)
          .get();
        const followerData = followerDoc.data();
        if (followerData?.fcmToken) {
          followerTokens.push(followerData.fcmToken);
        }
      }

      if (followerTokens.length === 0) {
        logger.info("No followers with FCM tokens found.");
        return;
      }

      const payload = {
        notification: {
          title: `${authorName} published a new post`,
          body: title,
        },
        data: {
          postId,
          summary: JSON.stringify(summary),
        },
      };

      await admin.messaging().sendEachForMulticast({
        tokens: followerTokens,
        ...payload,
      });

      logger.info(
        `Notifications stored and sent to ${followerTokens.length} followers.`,
      );
    } catch (error) {
      logger.error("Error processing notifications:", error);
    }
  },
);
