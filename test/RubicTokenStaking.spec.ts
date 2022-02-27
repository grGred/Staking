import { ethers, network } from 'hardhat';
import chai from 'chai';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import Web3 from 'web3';
import chaiAsPromised from 'chai-as-promised';
chai.use(chaiAsPromised);
const expect = chai.expect;

describe('RubicTokenStaking', function () {
    let BRBC;
    let RubicStaking;
    let signers;
    let Alice: SignerWithAddress;
    let Bob: SignerWithAddress;
    let Carol: SignerWithAddress;
    beforeEach('deploy', async function () {
        this.stakingContract = await ethers.getContractFactory('RubicTokenStaking');
        const BRBCToken = await ethers.getContractFactory('TestERC20');

        BRBC = await BRBCToken.deploy(Web3.utils.toWei('100000000', 'ether'));
        RubicStaking = await this.stakingContract.deploy(BRBC.address);

        signers = await ethers.getSigners();
        Alice = signers[1];
        Bob = signers[2];
        Carol = signers[3];

        await BRBC.mint(Alice.address, Web3.utils.toWei('100000', 'ether'));
        await BRBC.mint(Bob.address, Web3.utils.toWei('100000', 'ether'));
        await BRBC.mint(Carol.address, Web3.utils.toWei('100000', 'ether'));

        const blockNumBefore = await ethers.provider.getBlockNumber();
        const blockBefore = await ethers.provider.getBlock(blockNumBefore);
        const timestampBefore = blockBefore.timestamp;

        await RubicStaking.setStartDate(timestampBefore + 100);
        await network.provider.send('evm_setNextBlockTimestamp', [timestampBefore + 104]);
        await network.provider.send('evm_mine');
    });
    describe('staking tests', () => {
        it('First staker should claim all provided before rewards', async function () {
            await BRBC.connect(Carol).transfer(
                RubicStaking.address,
                Web3.utils.toWei('20', 'ether'),
                { from: Carol.address }
            );
            await BRBC.approve(RubicStaking.address, Web3.utils.toWei('10000', 'ether'));
            await RubicStaking.enter(Web3.utils.toWei('10000', 'ether'));
            await network.provider.send('evm_increaseTime', [
                Number(await RubicStaking.freezeTime())
            ]);
            await network.provider.send('evm_mine');
            expect(
                (await RubicStaking.canReceive(Web3.utils.toWei('10000', 'ether'))).toString()
            ).to.be.eq(Web3.utils.toWei('10020', 'ether'));
        });

        it('test enterTo', async () => {
            await BRBC.approve(RubicStaking.address, Web3.utils.toWei('10000', 'ether'));
            await RubicStaking.enterTo(Web3.utils.toWei('10000', 'ether'), Alice.address);

            let balance = await RubicStaking.balanceOf(Alice.address);
            expect(balance.toString()).to.be.equal(
                Web3.utils.toWei('10000', 'ether')
            );

            await network.provider.send('evm_increaseTime', [
                Number(await RubicStaking.freezeTime())
            ]);
            await network.provider.send('evm_mine');

            const AliceBalanceBefore = await RubicStaking.balanceOf(Alice.address);

            await RubicStaking.connect(Alice).leave(Web3.utils.toWei('10000', 'ether'));

            let balanceAlice = await RubicStaking.balanceOf(Alice.address);
            expect(((AliceBalanceBefore).sub(balanceAlice)).toString()).to.be.eq(
                Web3.utils.toWei('10000', 'ether')
            );
        });

        it('should not allow withdraw more than what you have', async function () {
            await BRBC.approve(RubicStaking.address, Web3.utils.toWei('10000', 'ether'));
            await RubicStaking.enter(Web3.utils.toWei('10000', 'ether'));
            await network.provider.send('evm_increaseTime', [
                Number(await RubicStaking.freezeTime())
            ]);
            await network.provider.send('evm_mine');
            await expect(RubicStaking.leave(Web3.utils.toWei('12000', 'ether'))).to.be.rejectedWith(
                'ERC20: burn amount exceeds balance'
            );
        });

        it('should not be able to transfer xBRBC until unfreeze time', async function () {
            await BRBC.approve(RubicStaking.address, Web3.utils.toWei('10000', 'ether'));
            await RubicStaking.enter(Web3.utils.toWei('10000', 'ether'));

            await expect(RubicStaking.transfer(Bob.address, '1')).to.be.rejectedWith(
                'ERC20: transfer amount exceeds balance'
            );

            await network.provider.send('evm_increaseTime', [
                Number(await RubicStaking.freezeTime())
            ]);
            await network.provider.send('evm_mine');

            await RubicStaking.transfer(Bob.address, '1');
            let balance = await RubicStaking.balanceOf(Bob.address);
            expect(balance.toString()).to.equal('1');
        });

        it('should work with more than one participant', async function () {
            await BRBC.connect(Alice).approve(
                RubicStaking.address,
                Web3.utils.toWei('10000', 'ether')
            );
            await BRBC.connect(Bob).approve(
                RubicStaking.address,
                Web3.utils.toWei('10000', 'ether'),
                { from: Bob.address }
            );
            // Alice enters and gets 2000 shares. Bob enters and gets 1000 shares.
            await RubicStaking.connect(Alice).enter(Web3.utils.toWei('2000', 'ether'));
            await RubicStaking.connect(Bob).enter(Web3.utils.toWei('1000', 'ether'), {
                from: Bob.address
            });
            let balanceAlice = await RubicStaking.balanceOf(Alice.address);
            expect(balanceAlice.toString()).to.equal(
                Web3.utils.toWei('2000', 'ether')
            );
            let balanceBob = await RubicStaking.balanceOf(Bob.address);
            expect(balanceBob.toString()).to.equal(
                Web3.utils.toWei('1000', 'ether')
            );
            let balanceStaking = await BRBC.balanceOf(RubicStaking.address);
            expect(balanceStaking.toString()).to.equal(
                Web3.utils.toWei('3000', 'ether')
            );
            // stakingContract get 3000 more BRBCs from an external source.
            await BRBC.connect(Carol).transfer(
                RubicStaking.address,
                Web3.utils.toWei('3000', 'ether'),
                { from: Carol.address }
            );
            // Alice deposits 1000 more BRBCs. She should receive 1000*3000/6000 = 500 shares.
            await RubicStaking.connect(Alice).enter(Web3.utils.toWei('1000', 'ether'));
            let balanceAliceAfter = await RubicStaking.balanceOf(Alice.address);
            expect(balanceAliceAfter.toString()).to.equal(
                Web3.utils.toWei('2500', 'ether')
            );
            let balanceBobAfter = await RubicStaking.balanceOf(Bob.address);
            expect(balanceBobAfter.toString()).to.equal(
                Web3.utils.toWei('1000', 'ether')
            );
            // Bob withdraws 500 shares. He should receive 500*7000/3500 = 1000 tokens
            let recieveAmount = await RubicStaking.canReceive(Web3.utils.toWei('500', 'ether'));
            expect(recieveAmount.toString()).to.be.eq(
                Web3.utils.toWei('1000', 'ether')
            );
            await expect(
                RubicStaking.connect(Bob).leave(Web3.utils.toWei('500', 'ether'), {
                    from: Bob.address
                })
            ).to.be.rejectedWith('ERC20: burn amount exceeds balance');
            await network.provider.send('evm_increaseTime', [
                Number(await RubicStaking.freezeTime())
            ]);
            await network.provider.send('evm_mine');
            await RubicStaking.connect(Bob).leave(Web3.utils.toWei('500', 'ether'), {
                from: Bob.address
            });
            let recieveAmount1 = await RubicStaking.canReceive(Web3.utils.toWei('500', 'ether'));
            expect(recieveAmount1.toString()).to.be.eq(
                Web3.utils.toWei('1000', 'ether')
            );
            let aliceBalance = await RubicStaking.balanceOf(Alice.address);
            expect(aliceBalance.toString()).to.equal(
                Web3.utils.toWei('2500', 'ether')
            );
            let stakingRecieves = await RubicStaking.canReceive(Web3.utils.toWei('2500', 'ether'));
            expect(stakingRecieves.toString()).to.be.eq(
                Web3.utils.toWei('5000', 'ether')
            );
            let bobBalance = await RubicStaking.balanceOf(Bob.address);
            expect(bobBalance.toString()).to.equal(
                Web3.utils.toWei('500', 'ether')
            );
            let rbcStakingAmount = await BRBC.balanceOf(RubicStaking.address);
            expect(rbcStakingAmount.toString()).to.equal(
                Web3.utils.toWei('6000', 'ether')
            );
            let rbcAliceAmount = await BRBC.balanceOf(Alice.address);
            expect(rbcAliceAmount.toString()).to.equal(
                Web3.utils.toWei('97000', 'ether')
            );
            let rbcBobAmount = await BRBC.balanceOf(Bob.address);
            expect(rbcBobAmount.toString()).to.equal(Web3.utils.toWei('100000', 'ether'));
        });
    });

    describe('Whitelist stake', () => {
        it('Add to whitelist', async function () {
            await RubicStaking.setWhitelist([Alice.address, Bob.address]);
            await BRBC.connect(Carol).approve(RubicStaking.address, Web3.utils.toWei('30000', 'ether'));

            expect(RubicStaking.connect(Carol).enterWhitelist(Web3.utils.toWei('10000', 'ether'))
            ).to.be.rejectedWith("you are not in whitelist");

            await BRBC.connect(Alice).approve(RubicStaking.address, Web3.utils.toWei('100000', 'ether'));
            await RubicStaking.connect(Alice).enterWhitelist(Web3.utils.toWei('15000', 'ether'));
            expect(RubicStaking.connect(Alice).enterWhitelist(Web3.utils.toWei('10001', 'ether'))
            ).to.be.rejectedWith("more than limit per user");
            await RubicStaking.connect(Alice).enter(Web3.utils.toWei('50000', 'ether')); // add 50 k in stake
            await RubicStaking.connect(Alice).enterWhitelist(Web3.utils.toWei('10000', 'ether')); // add 10k in whitelist
            let balanceAlice = await RubicStaking.balanceOf(Alice.address);
            expect(balanceAlice.toString()).to.be.eq(Web3.utils.toWei('75000', 'ether'));
        });

        it('whitelist time ended', async function () {
            await RubicStaking.setWhitelist([Alice.address, Bob.address]);
            await BRBC.connect(Alice).approve(RubicStaking.address, Web3.utils.toWei('100000', 'ether'));
            await BRBC.connect(Bob).approve(RubicStaking.address, Web3.utils.toWei('100000', 'ether'));

            await RubicStaking.connect(Alice).enterWhitelist(Web3.utils.toWei('15000', 'ether'));

            await network.provider.send('evm_increaseTime', [
                Number(86400 + 100)
            ]);
            await network.provider.send('evm_mine');
            /*
            expect(await RubicStaking.connect(Alice).enterWhitelist(Web3.utils.toWei('10000', 'ether'))
            ).to.be.rejectedWith("whitelist ended");
            */
            await RubicStaking.connect(Alice).enter(Web3.utils.toWei('50000', 'ether'));

            let balanceAlice = await RubicStaking.balanceOf(Alice.address);
            expect(balanceAlice.toString()).to.be.eq(Web3.utils.toWei('65000', 'ether'));
        });

        it('After whitelist', async function () {
            for (let i = 0; i < 63; i++) {
                await BRBC.mint(signers[i].address, '100000' + '0'.repeat(18));
                await BRBC.connect(signers[i]).approve(
                    RubicStaking.address,
                    '10000000000000000' + '0'.repeat(18)
                );
                await RubicStaking.connect(signers[i]).enter('100000' + '0'.repeat(18));
            }
            for (let i = 64; i < 70; i++) {
                await RubicStaking.setWhitelist([signers[i].address]);
                await BRBC.mint(signers[i].address, '100000' + '0'.repeat(18));
                await BRBC.connect(signers[i]).approve(RubicStaking.address, Web3.utils.toWei('30000', 'ether'));
                await RubicStaking.connect(signers[i]).enterWhitelist(Web3.utils.toWei('25000', 'ether'));
            } // now pool is 6.450.000, 550k are vacant
            // expect(RubicStaking.endWhitelist()).to.be.rejectedWith("whitelist not ended");
            await network.provider.send('evm_increaseTime', [
                Number(86400 + 100)
            ]);
            await network.provider.send('evm_mine');

            await RubicStaking.endWhitelist();
            await network.provider.send('evm_mine');
            let unfilled = await RubicStaking.unfilledAmount();
            let max = await RubicStaking.maxRBCTotal();
            expect(unfilled.toString()).to.be.eq(Web3.utils.toWei('550000', 'ether'));
            expect(max.toString()).to.be.eq(Web3.utils.toWei('7000000', 'ether'));

            for (let i = 70; i < 75; i++) {
                await BRBC.mint(signers[i].address, '100000' + '0'.repeat(18));
                await BRBC.connect(signers[i]).approve(
                    RubicStaking.address,
                    '10000000000000000' + '0'.repeat(18)
                );
                await RubicStaking.connect(signers[i]).enter('100000' + '0'.repeat(18));
            }
            await BRBC.mint(signers[76].address, '100000' + '0'.repeat(18));
                await BRBC.connect(signers[76]).approve(
                    RubicStaking.address,
                    '10000000000000000' + '0'.repeat(18)
                );
            expect(RubicStaking.connect(signers[76]).enter('50001' + '0'.repeat(18))
            ).to.be.rejectedWith("more than total limit");
            await RubicStaking.connect(signers[76]).enter('50000' + '0'.repeat(18));
        });
    });

    describe('utility', () => {
        it('should not allow enter if not enough approve', async function () {
            await expect(
                RubicStaking.connect(Alice).enter(Web3.utils.toWei('10000', 'ether'))
            ).to.be.rejectedWith('allowance insufficient');
            await BRBC.connect(Alice).approve(RubicStaking.address, '50');
            await expect(
                RubicStaking.connect(Alice).enter(Web3.utils.toWei('10000', 'ether'))
            ).to.be.rejectedWith('allowance insufficient');
            await BRBC.connect(Alice).approve(
                RubicStaking.address,
                Web3.utils.toWei('10000', 'ether')
            );
            await RubicStaking.connect(Alice).enter(Web3.utils.toWei('10000', 'ether'));
            let balanceAlice = await RubicStaking.balanceOf(Alice.address);
            expect(balanceAlice.toString()).to.equal(
                Web3.utils.toWei('10000', 'ether')
            );
        });

        it('should display available tokens', async () => {
            await BRBC.approve(RubicStaking.address, Web3.utils.toWei('10000', 'ether'));
            await RubicStaking.enter(Web3.utils.toWei('10000', 'ether'));
            expect((await RubicStaking.actualBalanceOf(signers[0].address)).toString()).to.be.eq(
                '0'
            );
            await network.provider.send('evm_increaseTime', [
                Number(await RubicStaking.freezeTime())
            ]);
            await network.provider.send('evm_mine');
            expect((await RubicStaking.actualBalanceOf(signers[0].address)).toString()).to.be.eq(
                Web3.utils.toWei('10000', 'ether')
            );
            expect((await RubicStaking.balanceOf(signers[0].address)).toString()).to.be.eq(
                Web3.utils.toWei('10000', 'ether')
            );
            expect((await RubicStaking.freezingBalanceOf(signers[0].address)).toString()).to.be.eq(
                Web3.utils.toWei('10000', 'ether')
            );
            expect(
                (await RubicStaking.canReceive(Web3.utils.toWei('10000', 'ether'))).toString()
            ).to.be.eq(Web3.utils.toWei('10000', 'ether'));
        });

        it('cant stake before start time', async () => {
            await RubicStaking.setStartDate('1738369056');
            expect(RubicStaking.enter('100')).to.be.rejectedWith('hasnt started yet');
        });

        it('cant stake more than user limit', async () => {
            expect(RubicStaking.enter('100001' + '0'.repeat(18))).to.be.rejectedWith(
                'more than limit per user'
            );
        });

        it('cant stake more than total limit', async () => {
            for (let i = 0; i < 63; i++) {
                await BRBC.mint(signers[i].address, '100000' + '0'.repeat(18));
                await BRBC.connect(signers[i]).approve(
                    RubicStaking.address,
                    '10000000000000000' + '0'.repeat(18)
                );
                await RubicStaking.connect(signers[i]).enter('100000' + '0'.repeat(18));
            }
            expect(
                RubicStaking.connect(signers[71]).enter('100000' + '0'.repeat(18))
            ).to.be.rejectedWith('more than total limit');
        });

        it('can decrease total limit and increase again', async () => {
            for (let i = 0; i < 63; i++) {
                await BRBC.mint(signers[i].address, '100000' + '0'.repeat(18));
                await BRBC.connect(signers[i]).approve(
                    RubicStaking.address,
                    '10000000000000000' + '0'.repeat(18)
                );
                await RubicStaking.connect(signers[i]).enter('100000' + '0'.repeat(18));
            }
            await BRBC.mint(signers[71].address, '100000' + '0'.repeat(18));
            expect(RubicStaking.connect(signers[71]).enter('100000' + '0'.repeat(18))
            ).to.be.rejectedWith('more than total limit');
            await network.provider.send('evm_increaseTime', [
                Number(await RubicStaking.freezeTime())
            ]);
            await BRBC.connect(Carol).transfer(
                RubicStaking.address,
                Web3.utils.toWei('700', 'ether'),
                { from: Carol.address }
            );
            await network.provider.send('evm_mine');
            await RubicStaking.leave('100000' + '0'.repeat(18));

            await BRBC.connect(signers[71]).approve(
                RubicStaking.address,
                '10000000000000000' + '0'.repeat(18)
            );

            RubicStaking.connect(signers[71]).enter('100000' + '0'.repeat(18)); // back to Limit (7100k)
        });

        it('sweep tokens test', async () => {
            const TestTokenFactory = await ethers.getContractFactory('TestERC20');
            const TestToken = await TestTokenFactory.deploy('100');

            await TestToken.transfer(RubicStaking.address, '100');
            let balanceSigner = await TestToken.balanceOf(signers[0].address);
            expect(balanceSigner.toString()).to.be.eq('0');
            await expect(RubicStaking.sweepTokens(BRBC.address)).to.be.rejectedWith(
                'cant sweep BRBC'
            );
            await RubicStaking.sweepTokens(TestToken.address);
            let balanceSignerAfter = await TestToken.balanceOf(signers[0].address);
            expect(balanceSignerAfter.toString()).to.be.eq('100');
        });
    });
});
